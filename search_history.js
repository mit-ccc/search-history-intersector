var MAX_QUERY_DISPLAY_CHARS = 40;
var HASH_OUTPUT_FILENAME = "search_hashes.out";
var PLAIN_OUTPUT_FILENAME = "search_queries.tsv";

// For "intersections", when the user intersects their queries with a friend's
var intersectHashes = {};
var intersectHashFilename = "";
var intersectHideDataMode = false;
var currentIntersectPw = "";

// For when "Also show related queries" button has been pressed
var relatedWordsMode = false;
var relatedWordsBaseQuery = "";
var relatedTerms = {};

var numQueries = 0;
var numKeywords = 0;
var redrawTimeout = 0;

var oTable;

// Read the zip file containing TakeOut data
function parseZipFile(zipFile) {
  // read the zip file
  JSZip.loadAsync(zipFile).then(
    function (zip) {
      // get a promise for decoding each file in the zip
      const fileParsePromises = [];

      // note zip does not have a .map function, so we push manually into the array
      var numFiles = 0;
      zip.forEach(function (relativePath, zipEntry) {
        if (zipEntry.name.match(/Location History\/Semantic Location History\/2020\//)) {
          // parse the file contents as a string
          fileParsePromises.push(
            zipEntry.async('string').then(function(data) {
              return { name: zipEntry.name,
                       textData: data,
                       zipEntry: zipEntry };}));
          numFiles++;
        }
      });
      // when all files have been parsed run the 
      // the text content of the files.
      Promise.all(fileParsePromises).then(processDecompressedFiles);
    },
    function(error) {
      console.error('An error occurred processing the zip file.', error);
      $("#loadingMessage").html("This does not seem to be a valid .zip file.  Please select the .zip file produced by Google Takeout.");
    }
  );
}

function updateLoadingMessageQueries(numQueries, numUniqueQueries, startDate,
                                     endDate) {
  if (numQueries == 0) {
    $("#loadingMessage").html("Could not find any search history data in the zip file.");
  } else {
    $("#loadingMessage").html(
      "Processed " + numQueries.toString() + " queries (" +
      numUniqueQueries.toString() + " unique) made between " +
      startDate.toLocaleDateString() + " and " + endDate.toLocaleDateString() +
      ". Average length: " +
      (Math.round(numKeywords * 1000.0 / numQueries) / 1000.0).toString() +
      " keywords");
  }
}

function extractPlaceVisit(placeVisit) {
  var name = placeVisit.location.name;
  if (name === undefined) {
    if (placeVisit.location.address !== undefined) {
      name = placeVisit.location.address;
    } else {
      name = placeVisit.location.placeId;
    }
  }
  var startDt = new Date(Math.floor(parseInt(
    placeVisit.duration.startTimestampMs) / 60000) * 60000);
  var endDt = new Date(Math.ceil(parseInt(
    placeVisit.duration.endTimestampMs) / 60000) * 60000);
  return([
    {"raw": name, "display": name},
    {"raw": startDt.valueOf(), "display": startDt},
    {"raw": endDt.valueOf(), "display": endDt},
    {"raw": placeVisit.visitConfidence,
      "display": placeVisit.visitConfidence},
    {"raw": placeVisit.placeConfidence,
      "display": placeVisit.placeConfidence},
    {"raw": placeVisit.location.placeId,
      "display": placeVisit.location.placeId},
]);
}

function extractActivity(activitySegment) {
  var startDt = new Date(Math.floor(parseInt(
    activitySegment.duration.startTimestampMs) / 60000) * 60000);
  var endDt = new Date(Math.ceil(parseInt(
    activitySegment.duration.endTimestampMs) / 60000) * 60000);
    return([
      {"raw": activitySegment.activityType,
        "display": activitySegment.activityType},
      {"raw": startDt.valueOf(), "display": startDt},
      {"raw": endDt.valueOf(), "display": endDt},
      {"raw": null,
        "display": null},
      {"raw": activitySegment.confidence,
        "display": activitySegment.confidence}]);
}

// do whatever processing of the decompressed zip file
function processDecompressedFiles(decompressedFiles) {

  var dataSet = [];
  
  // files
  for (var i = 0; i < decompressedFiles.length; i++) {
    var data = JSON.parse(decompressedFiles[i].textData);
    // timelineObjects
    for (var j = 0; j < data.timelineObjects.length; j++) {
      var tlObj = data.timelineObjects[j];
      // filter for placeVisits
      if (tlObj.placeVisit !== undefined) {
        dataSet.push(extractPlaceVisit(tlObj.placeVisit));
        // TODO(robon): Decide if we should remove parent xor child objects
        if (tlObj.placeVisit.childVisits !== undefined) {
          // childVisits
          for (var k = 0; k < tlObj.placeVisit.childVisits.length; k++) {
            var childVisit  = tlObj.placeVisit.childVisits[k];
            dataSet.push(extractPlaceVisit(childVisit));
          }
        }
      } else if (tlObj.activitySegment !== undefined) {
        // TODO(robon): Consider including activitySegments
        // dataSet.push(extractActivity(tlObj.activitySegment));
      }
    }
  }

  // create html table from dataSet
  oTable = $('#search_table').DataTable({
    "data": dataSet,
    "paging":   true,
    "lengthChange":   false,
    "searching":   true,
    "iDisplayLength":  50,
    "deferRender": true,
    "oLanguage": { "sSearch": "_INPUT_",
                   "sInfo": "Showing _START_ to _END_ of _TOTAL_ searches",
                   "sInfoFiltered": "filtered from _MAX_ total searches",
                   "sSearchPlaceholder": "Filter by keyword",
                   "sEmptyTable": "No data found",
                   "sZeroRecords": "No matching searches" },
     "columnDefs": [{ "title": "Location", "targets": 0,
                      "render":  {_: "raw", display: "display", sort: "raw"}},
                    { "title": "Start time", "targets": 1,
                      "render":  {_: "display", display: "display", sort: "display"}},
                    { "title": "End time", "targets": 2,
                      "render":  {_: "display", display: "display", sort: "display"}},
                    { "title": "Visit confidence", "targets": 3,
                      "render":  {_: "raw", display: "display", sort: "raw"}},
                    { "title": "Location confidence", "targets": 4,
                      "render":  {_: "raw", display: "display", sort: "raw"}},
                    { "title": "Location ID", "targets": 5,
                      "render":  {_: "raw", display: "display", sort: "raw", visible: false}}],
     "order": [[ 2, "desc" ], [1, "desc"]],
     "drawCallback": function( settings ) {
       // If some post-redraw work is in flight, cancel it
       if (redrawTimeout) {
         clearTimeout(redrawTimeout);
       }
       if (intersectHashFilename) {
         $("#intersectionMessage").html("<b>Restricting to searches that were also found in <i>" + intersectHashFilename + "</i></b>  <button onClick=\"intersectClear();\">Reset and show all</button>");
       }
       // Search count message
       var input = $("#search_table_filter").find("input")[0];
       if (!($(input).val()) && !intersectHashFilename && !relatedWordsMode) {
         $("#searchCountMessage").html("");
         $("#downloadPlainButton").text("Download all rows to a .tsv file");
       } else {
         redrawTimeout = setTimeout(function() {
           numMatchedQueries = 0;
           oTable.rows({filter: 'applied'}).every( function ( rowIdx, tableLoop, rowLoop ) {
             var data = this.data();
             numMatchedQueries += data[1];
           });
           var pct = (numQueries > 0) ? 100.0 * numMatchedQueries / numQueries : 0.0;
           pct = Math.round(pct * 100.0) / 100.0;
           $("#searchCountMessage").html(pct.toString() + "% of your searches matched.");
         }, 500);
         // Put the correct count in the download button
         $("#downloadPlainButton").text("Download these " + oTable.rows({filter: 'applied'}).count() + " rows to a .tsv file");
       }
     }
  });
  addExtraButtons();
  resetRelatedWords();

  // Register filter for intersection-with-friend and related-words mode
  $.fn.dataTable.ext.search.push(function(settings, data, dataIndex) {
    // Don't show any data if the intersector is typing their password
    if (intersectHideDataMode) return false;
    if (intersectHashFilename !== "") {
      var startDt = new Date(data[1]);
      var endDt = new Date(data[2]);
      var curDt = new Date(data[1]);
      while (curDt <= endDt) {
        var placeTs = data[5] + curDt.valueOf();
        var hash = queryToHash(placeTs, currentIntersectPw);
        curDt.setMinutes(curDt.getMinutes() + 1);
        if (intersectHashes[hash]) {
          //console.log(data);
          return true;
        }
      }
      return false;
    }
    // If it's related-words mode, filter out words that aren't related to input
    if (relatedWordsMode) {
      var toks = data[0].toLowerCase().split(' ');
      var matches = false;
      for (var i=0; i<toks.length; i++) {
        if (relatedTerms.hasOwnProperty(toks[i])
            || toks[i].startsWith(relatedWordsBaseQuery)) {
          matches = true;
          var strength = relatedTerms[toks[i]];
          if (!strength) {
            strength = (toks[i] === relatedWordsBaseQuery) ? CWV_MAX_DISTANCE :
            CWV_MAX_DISTANCE - 30;   // penalize non-exact match a little
          } else {
            strength = CWV_MAX_DISTANCE - strength;
          }
          strength = Math.round(strength * 10.0 / CWV_MAX_DISTANCE);  // make it out of 10
          oTable.cell(dataIndex, 4).data({"raw": strength, "display": strength.toString()});
          break;
        }
      }
      if (!matches) {
        return false;
      }
    }
    return true;
  });
}

function addExtraButtons() {
  // Header stuff
  $(".fg-toolbar:first").append("<span id=\"filterAddRelatedWordsButton\"><span>");
  $(".fg-toolbar:first").append("<span id=\"searchCountMessage\"><span>");

  // Footer buttons (export file and do intersection)
  $(".fg-toolbar:last").append("<br><br><div id=\"downloadPlainDiv\">");
  $(".fg-toolbar:last").append("<button id=\"downloadPlainButton\" onClick=\"downloadPlainFileClick()\" title=\"This button lets you save the data to a file so that you can work with it in a spreadsheet such as Google Sheets or Excel.\">Download all rows to a .tsv file</button> ");
  $(".fg-toolbar:last").append("</div>");

  $(".fg-toolbar:last").append("<div id=\"intersectionDiv\">");
  $(".fg-toolbar:last").append("<button id=\"downloadHashButton\" onClick=\"downloadHashFileClick()\" title=\"To see the searches you have in common with a friend, click this button to download the hashes to a file, and then send the file to your friend.  The friend should then select 'Intersect with a friend\''s hashes' below.\">Download hashes for all searches to a file</button> ");
  $(".fg-toolbar:last").append("<br><input type=\"file\" id=\"intersectFile\" /><button id=\"intersectButton\" onClick=\"intersectClick()\">Intersect with a friend's hashes</button>");
  $(".fg-toolbar:last").append("</div>");

  var intersectHashFileInput = document.querySelector('#intersectFile');
  intersectHashFileInput.addEventListener('change', function(event) {
    var files = event.target.files;
    intersectHashes = {};
    for (var i = 0; i < files.length; i++) {
      parseHashFile(files[i]);
    }
  });
}

function promptForPassword(isDownload) {
  if (isDownload) {
    // It's a hash download button click
    $("#hash-password-title").html("Enter a password to protect your hash file: ");
    $("#downloadHashButton").prop("disabled",true);
  } else {
    // It's an intersect button click
    $("#hash-password-title").html("Ask your friend to enter the password for their hash file: ");
    $("#intersectButton").prop("disabled",true);
  }
  $("#hash-password-form").show();
  $("#hash-password").focus();

  form = $("#hash-password-form").find("form").on("submit", function( event ) {
    event.preventDefault();
    $("#hash-password-form").hide();
    if (isDownload) {
      alert("It may take up to 30 seconds to compute your hash file before the download proceeds. Hit OK to continue.");
      $("#hash-password-message").html("Computing hashes.");
      downloadHashFile($("#hash-password").val());
    } else {
      $("#hash-password-message").html("Pick your friend's hash file.");
      $("#intersectFile").trigger("click");
      currentIntersectPw = $("#hash-password").val();
    }
    $("#hash-password-message").html("");
  });
}

function intersectClick() {
    // Hide the table so that the friend cannot see the queries
    intersectHideDataMode = true;
    $("#intersectionMessage").html("The data is hidden while the intersection password is being entered.");
    oTable.draw();
    alert("First your friend will type the password for their hash file, and then you will be asked to select it from your computer. Hit OK to continue.");
    promptForPassword(false);
}

function downloadHashFileClick() {
    promptForPassword(true);
}

function queryToHash(query, pw) {
    return sha256(query + pw);
}

function downloadHashFile(pw) {
  $("#downloadHashButton").html("Computing...");
  var text = "";
  oTable.rows().every( function ( rowIdx, tableLoop, rowLoop ) {
    var data = this.data();
    var startDt = new Date(data[1]["raw"]);
    var endDt = new Date(data[2]["raw"]);
    var curDt = new Date(data[1]["raw"]);
    while (curDt <= endDt) {
      //text = text + queryToHash(data[0]["raw"], pw) + "\n";
      text = text + queryToHash(data[5]["raw"] + curDt.valueOf(), pw) + "\n";
      curDt.setMinutes(curDt.getMinutes() + 1);
    }
  });

  var blob = new Blob([text], {type: "text/plain;charset=utf-8"});
  var hash_filename = HASH_OUTPUT_FILENAME + "." + Date.now();
  saveAs(blob, hash_filename);
  $("#downloadHashButton").html("Hashes downloaded to \"" + hash_filename+ "\"");
}

function downloadPlainFileClick() {
  $("#downloadPlainButton").html("Computing...");
  $("#downloadPlainButton").prop("disabled", true);
  alert("It may take a few moments to export the file. Hit OK to continue.");
  var text = "placeId\tname\tstartTimestampMs\tendTimestampMs\tlocationConfidence\tplaceConfidence\n";
  oTable.rows({filter: 'applied'}).every( function ( rowIdx, tableLoop, rowLoop ) {
    var data = this.data();
    text = text +
    // location cols
    data[5]["raw"] + "\t" + data[0]["raw"] +
    // datetime cols (timestamps)
    "\t" + data[1]["raw"] + "\t" + data[2]["raw"] +
    // confidence cols
    "\t" + data[3]["raw"] + "\t" + data[4]["raw"] + "\n";
  });
  var blob = new Blob([text], {type: "text/plain;charset=utf-8"});
  saveAs(blob, PLAIN_OUTPUT_FILENAME);
  $("#downloadPlainButton").html("Searches downloaded to \"" + PLAIN_OUTPUT_FILENAME + "\"");
  $("#downloadPlainButton").prop("disabled",false);
}


$("#file").change(function(event) {
  // TODO(robon): Update loading message
  //$("#loadingMessage").html("Loading search data...");
  var files = event.target.files;
  // requestAnimationFrame ensures status message is painted
	requestAnimationFrame(() => {
		for (var i = 0; i < files.length; i++) {
		  parseZipFile(files[i]);
		}
	});
});

function parseHashFile(hashFile) {
  var fr = new FileReader();
  fr.onload = function(e) {
    var hashes = e.target.result.split("\n");
    for (var i = 0; i < hashes.length; i++) {
      intersectHashes[hashes[i]] = 1;
    }
    intersectHashFilename = hashFile.name;
    $("#intersectButton").prop("disabled", false);
    intersectHideDataMode = false;
    oTable.draw();
  }
  fr.readAsText(hashFile);
}

function intersectClear() {
    intersectHashFilename = "";
    intersectHashes = {};
    $("#intersectionMessage").html("");
    oTable.draw();
}

function expandToRelatedWordsClick() {
    relatedWordsMode = true;
    $("#filterAddRelatedWordsButton").html("<button onClick=\"resetRelatedWordsClick();\">Reset filter</button>");
    $("#search_table_filter").prop("disabled", true);
    var input = $("#search_table_filter").find("input")[0];
    relatedWordsBaseQuery = $(input).val().toLowerCase();
    var relatedTermsList = related_words(relatedWordsBaseQuery);
    relatedTerms = {};
    for (var i=0; i<relatedTermsList.length; i++) {
        relatedTerms[relatedTermsList[i][0]] = relatedTermsList[i][1];
    }
    $(input).val("");
    $(input).trigger($.Event("keyup", { keyCode: 13 }));
    $(input).prop("disabled", true);
    oTable.column(4).visible(true);
    oTable.draw();
    $(input).val("Related to " + relatedWordsBaseQuery);
    $(oTable.column(4).header()).html("Relatedness to " + relatedWordsBaseQuery + " (out of 10)");
}

function linkToGoogle(query, display) {
    return "<a class=\"resultLink\" target=\"_blank\" href=\"https://www.google.com/search?q=" + encodeURIComponent(query) + "\">" + display + "</a>";
}

function resetRelatedWords() {
    relatedWordsMode = false;
    $("#filterAddRelatedWordsButton").html("<button onClick=\"expandToRelatedWordsClick();\">Also show related searches</button>");
    $("#filterAddRelatedWordsButton").hide();
}

function resetRelatedWordsClick() {
    resetRelatedWords();
    oTable.column(4).visible(false);
    oTable.draw();
    var input = $("#search_table_filter").find("input")[0];
    $(input).prop("disabled", false);
}
