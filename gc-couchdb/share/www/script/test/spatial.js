// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

couchTests.spatial = function(debug) {
  var db = new CouchDB("test_suite_db", {"X-Couch-Full-Commit":"false"});
  db.deleteDb();
  db.createDb();

  if (debug) debugger;


  var designDoc = {
    _id:"_design/spatial",
    language: "javascript",
    /* This is a 1.1.x feature, disable for now
    views: {
      lib: {
        geo: "exports.type = 'Point';"
      }
    }, */
    spatial : {
      basicIndex : stringFun(function(doc) {
        emit({
          type: "Point",
          coordinates: [doc.loc[0], doc.loc[1]]
        }, doc.string);
      }),
      dontEmitAll : stringFun(function(doc) {
        if (doc._id>5) {
          emit({
            type: "Point",
            coordinates: [doc.loc[0], doc.loc[1]]
          }, doc.string);
        }
      }),
      emitNothing : stringFun(function(doc) {}),
      geoJsonGeoms : stringFun(function(doc) {
        if (doc._id.substr(0,3)=="geo") {
          emit(doc.geom, doc.string);
        }
      })
      /* This is a 1.1.x feature, disable for now
      withCommonJs : stringFun(function(doc) {
        var lib = require('views/lib/geo');
        emit({
          type: lib.type,
          coordinates: [doc.loc[0], doc.loc[1]]
        }, doc.string);
      })*/
    }
  };

  T(db.save(designDoc).ok);


  function makeSpatialDocs(start, end, templateDoc) {
    var docs = makeDocs(start, end, templateDoc);
    for (var i=0; i<docs.length; i++) {
        docs[i].loc = [i-20+docs[i].integer, i+15+docs[i].integer];
    }
    return docs;
  }

  function extract_ids(str) {
    var json = JSON.parse(str);
    var res = [];
    for (var i in json.rows) {
      res.push(json.rows[i].id);
    }
    return res.sort();
  }

  // wait for a certain number of seconds
  function wait(secs) {
    var t0 = new Date(), t1;
    do {
      CouchDB.request("GET", "/");
      t1 = new Date();
    } while ((t1 - t0) < secs*1000);
  }

  function getGeomById(str, geomId) {
    var json = JSON.parse(str);
    for (var i in json.rows) {
      if (json.rows[i].id===geomId) {
        return json.rows[i].geometry;
      }
    }
  }

  // returns start_range and end_range arguments
  function rangeArgs(range) {
      return 'start_range=' + JSON.stringify(range.start) +
        '&end_range=' + JSON.stringify(range.end);
  }

  var xhr;
  var url_pre = '/test_suite_db/_design/spatial/_spatial/';
  var docs = makeSpatialDocs(0, 10);
  db.bulkSave(docs);
  db.save({_id: '10', string: '10', integer: 10, loc: [1,1]});
  var bbox = [-180, -90, 180, 90];

  // stale tests

  // make sure stale=ok doesn't trigger an update on not yet created index
  // NOTE There's no good way to test it => wait for 3 seconds
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(",") +
                        '&stale=ok');
  // wait 3 seconds for the next assertions to pass in very slow machines
  wait(3);
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(",") +
                        '&stale=ok');
  var resp = JSON.parse(xhr.responseText);
  TEquals(0, resp.rows.length, "should return no geometries (empty index)");

  // update the index
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  var lastUpdateSeq = JSON.parse(xhr.responseText).update_seq;

  // stale=ok
  db.save({"_id": "stale1", "loc": [50000,60000]});
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(",") +
                        "&stale=ok");
  T(JSON.parse(xhr.responseText).update_seq == lastUpdateSeq);
  wait(3);

  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(",") +
                        "&stale=ok");
  T(JSON.parse(xhr.responseText).update_seq == lastUpdateSeq);
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  T(JSON.parse(xhr.responseText).update_seq == lastUpdateSeq+1);

  // stale=update_after
  lastUpdateSeq++;
  db.save({"_id": "stale2", "loc": [60000,70000]});
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(",") +
                        "&stale=update_after");
  T(JSON.parse(xhr.responseText).update_seq == lastUpdateSeq);
  wait(3);
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(",") +
                        "&stale=ok");
  T(JSON.parse(xhr.responseText).update_seq == lastUpdateSeq+1);
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  T(JSON.parse(xhr.responseText).update_seq == lastUpdateSeq+1);


  // emit tests

  // spatial function that doesn't always emit
  bbox = [-180, -90, 180, 90];
  xhr = CouchDB.request("GET", url_pre + "dontEmitAll?bbox=" + bbox.join(","));
  TEquals(['10','6','7','8','9'], extract_ids(xhr.responseText),
          "should return geometries with id>5");

  xhr = CouchDB.request("GET", url_pre + "emitNothing?bbox=" + bbox.join(","));
  TEquals(JSON.parse(xhr.responseText).rows, [], "nothing emitted at all");


  // bounding box tests

  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  TEquals(['0','1','10','2','3','4','5','6','7','8','9'],
          extract_ids(xhr.responseText),
          "should return all geometries");

  bbox = [-20, 0, 16, 20];
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  TEquals(['0','1','10','2'], extract_ids(xhr.responseText),
          "should return a subset of the geometries");

  bbox = [-80, 90, 0, 180];
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  TEquals(JSON.parse(xhr.responseText).rows, [],
          "should return no geometries");

  bbox = [-18, -17, -14, 21];
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  TEquals(['1','2','3'], extract_ids(xhr.responseText),
          "should also return geometry at the bounds of the bbox");

  bbox = [-16, 19, -16, 19];
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  TEquals(['2'], extract_ids(xhr.responseText),
          "bbox collapsed to a point should return the geometries there");

  xhr = CouchDB.request("GET", url_pre + "basicIndex");
  TEquals(['0','1','10','2','3','4','5','6','7','8','9', 'stale1', 'stale2'],
          extract_ids(xhr.responseText),
          "no bounding box given should return all geometries");


  // Test range queries (those tests are the same as the bounding box ones)

  var range = {start: [-180, -90], end: [180, 90]};
  xhr = CouchDB.request("GET", url_pre + "basicIndex?" + rangeArgs(range));
  TEquals(['0','1','10','2','3','4','5','6','7','8','9'],
          extract_ids(xhr.responseText),
          "should return all geometries");

  range = {start: [-20, 0], end: [16, 20]};
  xhr = CouchDB.request("GET", url_pre + "basicIndex?" + rangeArgs(range));
  TEquals(['0','1','10','2'], extract_ids(xhr.responseText),
          "should return a subset of the geometries");

  range = {start: [-80, 90], end: [0, 180]};
  xhr = CouchDB.request("GET", url_pre + "basicIndex?" + rangeArgs(range));
  TEquals(JSON.parse(xhr.responseText).rows, [],
          "should return no geometries");

  range = {start: [-18, -17], end: [-14, 21]};
  xhr = CouchDB.request("GET", url_pre + "basicIndex?" + rangeArgs(range));
  TEquals(['1','2','3'], extract_ids(xhr.responseText),
          "should also return geometry at the bounds of the bbox");

  range = {start: [-16, 19], end: [-16, 19]};
  xhr = CouchDB.request("GET", url_pre + "basicIndex?" + rangeArgs(range));
  TEquals(['2'], extract_ids(xhr.responseText),
          "bbox collapsed to a point should return the geometries there");


  // count parameter tests

  xhr = CouchDB.request("GET", url_pre + "basicIndex?count=true");
  TEquals(13, JSON.parse(xhr.responseText).count,
          "should return the count of all geometries");

  bbox = [-20, 0, 16, 20];
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(",") +
                        "&count=true");
  TEquals(4, JSON.parse(xhr.responseText).count,
          "should return the count of a subset (bbox)");

  range = {start: [-20, 0], end: [16, 20]};
  xhr = CouchDB.request("GET", url_pre + "basicIndex?" + rangeArgs(range) +
                        "&count=true");
  TEquals(4, JSON.parse(xhr.responseText).count,
          "should return the count of a subset (range)");


  // GeoJSON geometry tests
  // NOTE vmx: (for all those tests) Should I test if the returned
  //     bounding box is correct as well?

  // some geometries are based on the GeoJSON specification
  // http://geojson.org/geojson-spec.html (2010-08-17)
  var geoJsonDocs = [{"_id": "geoPoint", "geom": { "type": "Point", "coordinates": [100.0, 0.0] }},
    {"_id": "geoLineString", "geom": { "type": "LineString", "coordinates":[
      [100.0, 0.0], [101.0, 1.0]
    ]}},
    {"_id": "geoPolygon", "geom": { "type": "Polygon", "coordinates": [
      [ [100.0, 0.0], [101.0, 0.0], [100.0, 1.0], [100.0, 0.0] ]
    ]}},
    {"_id": "geoPolygonWithHole", "geom": { "type": "Polygon", "coordinates": [
      [ [100.0, 0.0], [101.0, 0.0], [100.0, 1.0], [100.0, 0.0] ],
      [ [100.2, 0.2], [100.6, 0.2], [100.2, 0.6], [100.2, 0.2] ]
    ]}},
    {"_id": "geoMultiPoint", "geom": { "type": "MultiPoint", "coordinates": [
      [100.0, 0.0], [101.0, 1.0]
    ]}},
    {"_id": "geoMultiLineString", "geom": { "type": "MultiLineString",
      "coordinates": [
      [ [100.0, 0.0], [101.0, 1.0] ],
      [ [102.0, 2.0], [103.0, 3.0] ]
      ]
    }},
    {"_id": "geoMultiPolygon", "geom": { "type": "MultiPolygon",
      "coordinates": [
      [[[102.0, 2.0], [103.0, 2.0], [103.0, 3.0], [102.0, 3.0], [102.0, 2.0]]],
      [
        [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]],
        [[100.2, 0.2], [100.8, 0.2], [100.8, 0.8], [100.2, 0.8], [100.2, 0.2]]
      ]
      ]
    }},
    {"_id": "geoGeometryCollection", "geom": { "type": "GeometryCollection",
      "geometries": [
        { "type": "Point", "coordinates": [100.0, 0.0] },
        { "type": "LineString", "coordinates": [ [101.0, 0.0], [102.0, 1.0] ]}
      ]
    }}
  ];
  db.bulkSave(geoJsonDocs);

  bbox = [100.0, 0.0, 100.0, 0.0];
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" + bbox.join(","));
  TEquals(true, /geoPoint/.test(extract_ids(xhr.responseText)),
          "if bounding box calculation was correct, it should at least" +
          " return the geoPoint");

  bbox = [100.8, 0.8, 101.0, 1.0],
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" + bbox.join(","));
  TEquals(true, /geoPolygon/.test(extract_ids(xhr.responseText)),
          "if bounding box calculation was correct, it should at least" +
          " return the geoPolygon");

  bbox = [100.8, 0.8, 101.0, 1.0],
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" + bbox.join(","));
  TEquals(true, /geoPolygonWithHole/.test(extract_ids(xhr.responseText)),
          "if bounding box calculation was correct, it should at least" +
          " return the geoPolygonWithHole");

  bbox = [100.1, 0.8, 100.2, 1.5],
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" + bbox.join(","));
  TEquals(true, /geoMultiPoint/.test(extract_ids(xhr.responseText)),
          "if bounding box calculation was correct, it should at least" +
          " return the geoMultiPoint");

  bbox = [101.2, 1.3, 101.6, 1.5];
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" + bbox.join(","));
  TEquals(true, /geoMultiLineString/.test(extract_ids(xhr.responseText)),
          "if bounding box calculation was correct, it should at least" +
          " return the geoMultiLineString");

  bbox = [101.2, 2.3, 101.6, 3.5];
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" + bbox.join(","));
  TEquals(true, /geoMultiPolygon/.test(extract_ids(xhr.responseText)),
          "if bounding box calculation was correct, it should at least" +
          " return the geoMultiPolygon");

  bbox = [102, 0, 102, 0];
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" + bbox.join(","));
  TEquals(true, /geoGeometryCollection/.test(extract_ids(xhr.responseText)),
          "if bounding box calculation was correct, it should at least" +
          " return the geoGeometryCollection");

  // Test if all geometries were serialised correctly
  bbox = [90, -1, 110, 10];
  xhr = CouchDB.request("GET", url_pre + "geoJsonGeoms?bbox=" +
                        bbox.join(","));
  TEquals(geoJsonDocs[0].geom, getGeomById(xhr.responseText, 'geoPoint'),
          'Point was serialised correctly');
  TEquals(geoJsonDocs[1].geom, getGeomById(xhr.responseText, 'geoLineString'),
          'LineString was serialised correctly');
  TEquals(geoJsonDocs[2].geom, getGeomById(xhr.responseText, 'geoPolygon'),
          'Polygon was serialised correctly');
  TEquals(geoJsonDocs[3].geom,
          getGeomById(xhr.responseText, 'geoPolygonWithHole'),
          'Polygon (with holw) was serialised correctly');
  TEquals(geoJsonDocs[4].geom, getGeomById(xhr.responseText, 'geoMultiPoint'),
          'MultiPoint was serialised correctly');
  TEquals(geoJsonDocs[5].geom,
          getGeomById(xhr.responseText, 'geoMultiLineString'),
          'point MultiLineString serialised correctly');
  TEquals(geoJsonDocs[6].geom,
          getGeomById(xhr.responseText, 'geoMultiPolygon'),
          'MultiPolygon was serialised correctly');
  TEquals(geoJsonDocs[7].geom,
          getGeomById(xhr.responseText, 'geoGeometryCollection'),
          'GeometryCollection was serialised correctly');


  bbox = [11, 24, -10, 6];
  xhr = CouchDB.request("GET", url_pre + "basicIndex?bbox=" + bbox.join(","));
  TEquals(400, xhr.status,
    "flipped bbox returns an error");
};
