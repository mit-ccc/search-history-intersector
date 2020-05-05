
// Javascript functions for operating on compact word vectors
// Requires that "word_vectors" has been set by including a data file such
// as word_vector_data_mikolov1.js

var CWV_MAX_DISTANCE = 300;

function get_word_vector(w) {
    var vec = word_vectors[w.toLowerCase()];
    if (!vec) return null;
    return decode64(vec);
}

function word_distance(word1, word2) {
    var bytes1 = get_word_vector(word1);
    var bytes2 = get_word_vector(word2);
    if (!bytes1 || !bytes2) return CWV_MAX_DISTANCE;  // A word wasn't found
    return word_vector_distance(bytes1, bytes2);
}

function word_vector_distance(bytes1, bytes2) {
    var bitsInCommon = 0;
    for (var i=0; i<bytes1.length; i++) {
        var b1 = bytes1.charCodeAt(i);
        var b2 = bytes2.charCodeAt(i);
        var res = b1 ^ b2;
        while (res !== 0) {
            bitsInCommon += res & 1;
            res = res >> 1;
        }
    }
    return bitsInCommon;
}

function related_words(word1) {
    var results = [];
    var bytes1 = get_word_vector(word1);
    if (bytes1) {
        Object.keys(word_vectors).forEach(function(key, index) {
                if (word1 !== key) {
                    var bytes2 = get_word_vector(key);
                    var distance = word_vector_distance(bytes1, bytes2);
                    if (distance < 110) {
                        results.push([key, distance]);
                    }
                }
            });
    }
    results.sort(function(a, b) { return a[1] - b[1]; });
    return results;
}
