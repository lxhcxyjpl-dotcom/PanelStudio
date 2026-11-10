// Invoked by check.ps1 with a manifest entry and a unique output directory.
(function (spec, inputPath, outputDir) {
  __FONT_HELPER__
  var previousLevel = app.userInteractionLevel, previousCoordinates = app.coordinateSystem;
  var doc = null, reopened = null, pt = 72 / 25.4;
  var result = { sample: spec.name, version: app.version, build: app.buildNumber, checks: [], panels: [] };
  function check(name, passed, value) { result.checks.push({ name: name, pass: !!passed, value: value }); }
  function serialized(x) {
    if (x === null || typeof x === "undefined") return "null";
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    if (typeof x === "string") return '"' + x.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
    var fields = [], key;
    if (x instanceof Array) { for (key = 0; key < x.length; key++) fields.push(serialized(x[key])); return "[" + fields.join(",") + "]"; }
    for (key in x) if (x.hasOwnProperty(key)) fields.push(serialized(key) + ":" + serialized(x[key]));
    return "{" + fields.join(",") + "}";
  }
  function byText(d, text) {
    for (var i = 0; i < d.textFrames.length; i++) if (d.textFrames[i].contents === text) return d.textFrames[i];
    return null;
  }
  function curveOf(d) {
    for (var i = 0; i < d.pathItems.length; i++) {
      var path = d.pathItems[i];
      if (path.clipping || path.closed) continue;
      for (var j = 0; j < path.pathPoints.length; j++) {
        var p = path.pathPoints[j], a = p.anchor, r = p.rightDirection;
        if (Math.abs(a[0]-r[0]) + Math.abs(a[1]-r[1]) > 0.01) return { path: path, point: p };
      }
    }
    return null;
  }
  function png(d, filename) {
    var options = new ExportOptionsPNG24(); options.antiAliasing = true; options.artBoardClipping = true;
    options.horizontalScale = 150 / 72 * 100; options.verticalScale = options.horizontalScale;
    options.transparency = false;
    d.exportFile(new File(filename), ExportType.PNG24, options);
  }
  function round(n) { return Math.round(n * 10000) / 10000; }
  function mmRect(b, board) { return [round((b[0]-board[0])/pt), round((board[1]-b[1])/pt),
    round((b[2]-b[0])/pt), round((b[1]-b[3])/pt)]; }
  function frameError(rect, frame) {
    return Math.max(Math.abs(rect[0]-frame.x), Math.abs(rect[1]-frame.y), Math.abs(rect[2]-frame.width), Math.abs(rect[3]-frame.height));
  }
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    doc = app.open(new File(inputPath));
    if (__RESTORE_FACES__) result.fontRestoration = restorePanelStudioLabelFaces(doc, new File(inputPath));
    var board = doc.artboards[0].artboardRect, width = (board[2] - board[0])/pt, height = (board[1] - board[3])/pt;
    check("Artboard dimensions within 0.1 mm", Math.abs(width-spec.width)<=0.1 && Math.abs(height-spec.height)<=0.1, [round(width), round(height)]);
    check("Independent raster objects", doc.rasterItems.length + doc.placedItems.length === spec.rasters, [doc.rasterItems.length, doc.placedItems.length]);
    var gradients = 0, translucent = false, i, j;
    for (i=0; i<doc.pathItems.length; i++) {
      var path = doc.pathItems[i];
      if (path.filled && path.fillColor.typename==="GradientColor") gradients++;
    }
    for (i=0; i<doc.pageItems.length; i++) if (spec.opacity !== null && Math.abs(doc.pageItems[i].opacity-spec.opacity)<0.5) translucent = true;
    check("Editable gradient paint", gradients>0, gradients);
    if (spec.opacity !== null) check("Group opacity", translucent, spec.opacity);
    var initial = [], groups = [], seen = {};
    for (i=0;i<spec.panels.length;i++) {
      var expected = spec.panels[i], text = byText(doc, expected.text);
      check("Native label " + expected.text, text !== null, text ? text.typename : "missing");
      if (!text) continue;
      var size = text.textRange.characterAttributes.size, face = text.textRange.characterAttributes.textFont;
      var actual = text.anchor, x = (actual[0]-board[0])/pt, y = (board[1]-actual[1])/pt;
      result.panels.push({ label: expected.text, font: face.name, family: face.family, sizePt: size, baselineMm: [round(x),round(y)] });
      check("Font and weight " + expected.text, face.family === expected.font && (expected.weight===700 ? /bold/i.test(face.style) : /regular|normal/i.test(face.style)), face.name);
      check("Label size within 0.1 pt " + expected.text, Math.abs(size-expected.size)<=0.1, round(size-expected.size));
      check("Label baseline within 0.1 mm " + expected.text, Math.max(Math.abs(x-expected.x),Math.abs(y-expected.y))<=0.1, [round(x-expected.x),round(y-expected.y)]);
      var group = text.parent, id = group.typename==="GroupItem" ? group.uuid : "";
      check("Independent panel group " + expected.text, !!id && !seen[id], group.name);
      if (id) seen[id]=true;
      initial.push([actual[0],actual[1]]); groups.push(id ? group : null);
      var best=Infinity, matched=null;
      for (j=0;j<doc.pathItems.length;j++) {
        var item=doc.pathItems[j]; if (!item.clipping) continue;
        var rect=mmRect(item.geometricBounds,board), error=frameError(rect,expected.frame);
        if (error<best) {best=error;matched=rect;}
      }
      check("Crop frame within 0.1 mm " + expected.text, best<=0.1, matched);
    }
    png(doc,outputDir+"/"+spec.name+"-illustrator.png");
    for (i=0;i<groups.length;i++) {
      var g=groups[i]; if (!g) continue;
      doc.selection=null; g.selected=true; g.translate(pt,0);
      var translated=true;
      for (j=0;j<spec.panels.length;j++) {
        var after=byText(doc,spec.panels[j].text);
        if (!after || !initial[j] || Math.abs((after.anchor[0]-initial[j][0])/pt-(i===j?1:0))>0.1 ||
            Math.abs((after.anchor[1]-initial[j][1])/pt)>0.1) translated=false;
      }
      g.translate(-pt,0); check("Independent 1 mm translation " + spec.panels[i].text,translated,1);
    }
    var first=byText(doc,spec.panels[0].text); if(first)first.contents="X";
    var internal=byText(doc,"n=12"); if(internal)internal.contents="n=13";
    var curve=curveOf(doc), handle=null;
    if(curve){var right=curve.point.rightDirection; handle=[right[0]+pt,right[1]];curve.point.rightDirection=handle;}
    var ai=new File(outputDir+"/"+spec.name+".ai"), save=new IllustratorSaveOptions(); save.pdfCompatible=true; doc.saveAs(ai,save);
    doc.close(SaveOptions.DONOTSAVECHANGES); doc=null;
    // A background native save can return before the PDF-compatible file is
    // complete. Check the trailer and stable file length before asking Adobe to parse it.
    var stable=0, lastSize=-1;
    for (var attempt=0;attempt<80 && stable<6;attempt++) {
      $.sleep(250);
      var probe=new File(ai.fsName), size=probe.length, complete=false;
      probe.encoding="BINARY";
      if (size>64 && probe.open("r")) {
        try { probe.seek(-64,2); complete=probe.read().indexOf("%%EOF")>=0; }
        finally { probe.close(); }
      }
      stable=complete && size===lastSize ? stable+1 : 0;
      lastSize=size;
    }
    if (stable<6) throw new Error("The native save did not finish within 20 seconds.");
    reopened=app.open(ai); app.redraw();
    check("Native AI reopen", reopened.artboards.length===1, reopened.artboards.length);
    check("Edited native label persisted",!!byText(reopened,"X"),"X");
    check("Edited imported native text persisted",!!byText(reopened,"n=13"),"n=13");
    var reopenedFaces=[], allFaces=true, correctSizes=true;
    for(i=0;i<spec.panels.length;i++) {
      var want=spec.panels[i], tf=byText(reopened,i===0?"X":want.text);
      if(!tf){allFaces=false;correctSizes=false;continue;}
      var ff=tf.textRange.characterAttributes.textFont, postscript=want.font.replace(/ /g,"")+(want.weight===700?"-Bold":"-Regular");
      reopenedFaces.push(ff.name);
      if(ff.name!==postscript)allFaces=false;
      if(Math.abs(tf.textRange.characterAttributes.size-want.size)>0.1)correctSizes=false;
    }
    check("Requested label faces survived native reopen",allFaces,reopenedFaces);
    check("Label sizes survived native reopen within 0.1 pt",correctSizes,spec.panels.length);
    var retained=false;
    if(handle)for(i=0;i<reopened.pathItems.length;i++){
      var pts=reopened.pathItems[i].pathPoints;
      for(j=0;j<pts.length;j++){var rr=pts[j].rightDirection;
        if(Math.abs(rr[0]-handle[0])<0.1*pt && Math.abs(rr[1]-handle[1])<0.1*pt)retained=true;}
    }
    check("Edited Bezier handle persisted",retained,handle);
    check("Rasters persisted after reopen",reopened.rasterItems.length+reopened.placedItems.length===spec.rasters,reopened.rasterItems.length+reopened.placedItems.length);
  } catch(e) {check("Illustrator execution",false,String(e)+" at line "+e.line);}
  finally {
    if(reopened)reopened.close(SaveOptions.DONOTSAVECHANGES);
    if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);
    app.coordinateSystem=previousCoordinates;app.userInteractionLevel=previousLevel;
  }
  return serialized(result);
})(__SPEC__, __INPUT__, __OUTPUT__);
