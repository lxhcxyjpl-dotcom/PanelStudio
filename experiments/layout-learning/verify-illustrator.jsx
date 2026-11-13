(function(filePath, spec) {
  var previousLevel=app.userInteractionLevel, previousCoordinates=app.coordinateSystem, doc=null, unit=72/25.4;
  function delta(a,b){var v=0;for(var i=0;i<4;i++)v=Math.max(v,Math.abs(a[i]-b[i]));return v;}
  try {
    app.userInteractionLevel=UserInteractionLevel.DONTDISPLAYALERTS;
    app.coordinateSystem=CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    doc=app.open(new File(filePath));
    var board=doc.artboards[0].artboardRect, canvasError=Math.max(Math.abs((board[2]-board[0])/unit-spec.canvas[0]),
      Math.abs((board[1]-board[3])/unit-spec.canvas[1]));
    var items=[], frames=[], used={}, worst=0, moved=true, i,j;
    for(i=0;i<doc.rasterItems.length;i++)items.push(doc.rasterItems[i]);
    for(i=0;i<doc.placedItems.length;i++)items.push(doc.placedItems[i]);
    for(i=0;i<items.length;i++){
      var b=items[i].geometricBounds;
      frames.push([(b[0]-board[0])/unit,(board[1]-b[1])/unit,(b[2]-board[0])/unit,(board[1]-b[3])/unit]);
    }
    for(i=0;i<spec.boxes.length;i++){
      var best=-1, error=1e6;
      for(j=0;j<items.length;j++)if(!used[j] && delta(frames[j],spec.boxes[i])<error){
        best=j; error=delta(frames[j],spec.boxes[i]);
      }
      if(best<0){worst=1e6;break;}
      used[best]=true; worst=Math.max(worst,error);
    }
    for(i=0;i<items.length;i++){
      var original=[];for(j=0;j<items.length;j++)original.push(items[j].geometricBounds);
      items[i].translate(unit,0);
      for(j=0;j<items.length;j++){
        var target=original[j].slice(0);
        if(i===j){target[0]+=unit;target[2]+=unit;}
        if(delta(items[j].geometricBounds,target)>.06)moved=false;
      }
      items[i].translate(-unit,0);
    }
    return [app.version,doc.artboards.length,canvasError,items.length,worst,moved,doc.rasterItems.length].join("|");
  } finally {
    if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);
    app.coordinateSystem=previousCoordinates;app.userInteractionLevel=previousLevel;
  }
})(__INPUT__,__SPEC__)
