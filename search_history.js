
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
                    if (zipEntry.name.match(/Search\/MyActivity\.html/)) {
                        // parse the file contents as a string
                        fileParsePromises.push
                            (zipEntry.async('string').then(function(data) {
                                    return {
                                        name: zipEntry.name,
                                            textData: data,
                                            zipEntry: zipEntry,
                                            };
                                })
                                );
                        numFiles++;
                    }
                });

            // when all files have been parsed run the processing step with
            // the text content of the files.
            Promise.all(fileParsePromises).then(processDecompressedFiles);
        },
        function(error) {
            console.error('An error occurred processing the zip file.', error);
            $("#loadingMessage").html("This does not seem to be a valid .zip file.  Please select the .zip file produced by Google Takeout.");
        }
                                );

}

function updateLoadingMessageQueries(numQueries, numUniqueQueries,
                                     startDate, endDate) {
    if (numQueries == 0) {
        $("#loadingMessage").html("Could not find any search history data in the zip file.");
    } else {
        $("#loadingMessage").html("Processed " + numQueries.toString() + " queries (" +
                                  numUniqueQueries.toString() + " unique) made between " +
                                  startDate.toLocaleDateString() + " and " +
                                  endDate.toLocaleDateString() + ". Average length: " +
                                  (Math.round(numKeywords * 1000.0 / numQueries) / 1000.0).toString() + " keywords");
    }
}

// do whatever processing of the decompressed zip file
function processDecompressedFiles(decompressedFiles) {
    // Spit out queries
    var earliestDate = 0;
    var latestDate = 0;
    numQueries = 0;
    var numUniqueQueries = 0;

    queryInfos = {};
    var regex1 = RegExp('Searched for[^>]*>([^<]*)</a><br>([^<]*)</div>', 'g');

    for (var i=0; i<decompressedFiles.length; i++) {
        var data = decompressedFiles[i].textData;

        do {
            m = regex1.exec(data);
            if (!m) continue;
            var query = m[1];
            var date = new Date(Date.parse(m[2]));
            query = query.trim().replace(/[\"]/g, "");  // trim and remove quotes for display
            var year = 1900 + date.getYear();
            var qi;
            var lookupQuery = query.toLowerCase(); // case insensitive aggregation
            if (queryInfos.hasOwnProperty(lookupQuery)) {
                qi = queryInfos[lookupQuery];
                qi["count"]++;
                if (qi["years"].indexOf(year) == -1) {
                    qi["years"].push(year);
                }
                if (date > qi["d"]) {
                    qi["d"] = date;
                }
            } else {
                numUniqueQueries++;
                qi = {"q": query, "d": date, "count": 1, "years": [year]};
            }

            queryInfos[lookupQuery] = qi;
            numQueries++;
            numKeywords += lookupQuery.split(" ").length;

            if (!earliestDate || (date < earliestDate)) earliestDate = date;
            if (date > latestDate) latestDate = date;
            if (numQueries % 10000 == 0) {
                updateLoadingMessageQueries(numQueries, numUniqueQueries, earliestDate, latestDate);
            }
        } while (m);
    }

    updateLoadingMessageQueries(numQueries, numUniqueQueries, earliestDate, latestDate);

    var latestYear = 1900 + latestDate.getYear();
    var earliestYear = 1900 + earliestDate.getYear();

    dataSet = [];
    Object.keys(queryInfos).forEach(function(key, index) {
            var qi = queryInfos[key];
            var displayQuery = qi["q"];
            var safeQuery = qi["q"];
            if (displayQuery.length > MAX_QUERY_DISPLAY_CHARS) {
                displayQuery = displayQuery.substring(0, MAX_QUERY_DISPLAY_CHARS) + "... ";
            }
            displayQuery = linkToGoogle(safeQuery, displayQuery);

            var fullDateString = qi["d"].toLocaleString();
            var dateString =  qi["d"].toLocaleDateString();
            var years = qi["years"];
            years.sort();
            var yearString = "<tt>";
            var yearScore = 0;  // Used to group like year-sequences
            var d = 1;
            for (var i=earliestYear; i<=latestYear; i++) {
                if (years.indexOf(i) != -1) {
                    yearString += i.toString() + "&nbsp;";
                    yearScore += d;
                } else {
                    yearString += "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
                }
                d *= 2;
            }
            yearScore = years.length * 1000 + yearScore;  // prioritize more years
            yearString += "</tt>";

            dataSet.push([
                          {"raw": qi["q"], "display": "<span title=\"" + safeQuery + "\">" + displayQuery + "</span>"},
                          qi["count"],
                          {"raw": years, "display": yearString, "weight": yearScore},
                          {"raw": dateString, 
                                  "display": "<span title=\"" + fullDateString + "\">" + dateString + "</span>"},
                          {"raw": 0.0, "display": "0",}
                          ]);

        });

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
                "columnDefs":
                    [
                     { "title": "Search query", "targets": 0,
                             "render":  {_: "raw", display: "display", sort: "raw"}},
                     { "title": "Number of searches",
                             "orderSequence": [ "desc", "asc" ],
                             "width": "100px", "className": "dt-right",
                             "targets": 1 },
                     { "title": "Years searched", "targets": 2,
                             "orderSequence": [ "desc", "asc" ],
                             "className": "dt-right",
                             "render":  {_: "raw", display: "display", sort: "weight"}},
                     { "title": "Most recent search", "targets": 3,
                             "orderSequence": [ "desc", "asc" ],
                             "className": "dt-right",
                             "render":  {_: "raw", display: "display", sort: "raw"}},
                     { "title": "Related to", "targets": 4,
                             "orderSequence": [ "desc", "asc" ],
                             "className": "dt-right",
                             "visible": false,
                             "render":  {_: "raw", display: "display", sort: "raw"}}
                     ],
            "order": [[ 1, "desc" ], [3, "desc"], [2, "desc"]],
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
    $.fn.dataTable.ext.search
        .push(function( settings, data, dataIndex ) {
                if (intersectHideDataMode) return false;  // Don't show any data if the intersector is typing their password
                if (intersectHashFilename !== "") {
                    var query = data[0];
                    var hash = queryToHash(query, currentIntersectPw);
                    if (!intersectHashes[hash]) return false;
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
                            }
                            else strength = CWV_MAX_DISTANCE - strength;
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

    // Register trigger for revealing "Also show related queries" button
    oTable.on('search.dt', function () {
            var input = $("#search_table_filter").find("input")[0];
            if ($(input).val()) {
                $("#filterAddRelatedWordsButton").show();
            }
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

    form = $("#hash-password-form").find( "form" ).on( "submit", function( event ) {
            event.preventDefault();
            $("#hash-password-form").hide();
            if (isDownload) {
                alert("It may take up to 30 seconds to compute your hash file before the download proceeds.  Hit OK to continue.");
                $("#hash-password-message").html("Computing hashes.");
                downloadHashFile($("#hash-password").val());
            } else {
                $("#hash-password-message").html("Pick your friend's hash file.");
                $( '#intersectFile' ).trigger( 'click' );
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
    alert("First your friend will type the password for their hash file, and then you will be asked to select it from your computer.  Hit OK to continue.");
    promptForPassword(false);
}

function downloadHashFileClick() {
    promptForPassword(true);
}

function queryToHash(query, pw) {
    return sha256(query.toLowerCase() + pw);
}

function downloadHashFile(pw) {
    $("#downloadHashButton").html("Computing...");
    var text = "";
    oTable.rows().every( function ( rowIdx, tableLoop, rowLoop ) {
            var data = this.data();
            text = text + queryToHash(data[0]["raw"], pw) + "\n";
        });

    var blob = new Blob([text], {type: "text/plain;charset=utf-8"});
    saveAs(blob, HASH_OUTPUT_FILENAME);
    $("#downloadHashButton").html("Hashes downloaded to \"" + HASH_OUTPUT_FILENAME + "\"");
}

function downloadPlainFileClick() {
    $("#downloadPlainButton").html("Computing...");
    $("#downloadPlainButton").prop("disabled", true);
    alert("It may take a few moments to export the file.  Hit OK to continue.");
    var text = "";
    oTable.rows({filter: 'applied'}).every( function ( rowIdx, tableLoop, rowLoop ) {
            var data = this.data();
            text = text + data[0]["raw"] + "\t" + data[1].toString() + "\t" + data[2]["raw"] + "\t" + data[3]["raw"] + "\n";
        });
    var blob = new Blob([text], {type: "text/plain;charset=utf-8"});
    saveAs(blob, PLAIN_OUTPUT_FILENAME);
    $("#downloadPlainButton").html("Searches downloaded to \"" + PLAIN_OUTPUT_FILENAME + "\"");
    $("#downloadPlainButton").prop("disabled",false);
}


$("#file").change(function(event) {
        $("#loadingMessage").html("Loading search data...");
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
        for (var i=0; i<hashes.length; i++) {
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