#target illustrator
#include "label-faces.jsxinc"

// Run via File > Scripts > Other Script after opening a PanelStudio SVG.
(function () {
  try {
    if (!app.documents.length) throw new Error("Open a PanelStudio SVG first.");
    var doc = app.activeDocument, source = doc.fullName;
    if (!source || !/\.svg$/i.test(source.name)) throw new Error("Open the original exported SVG first.");
    var result = restorePanelStudioLabelFaces(doc, source);
    alert("PanelStudio: " + result.labels + " labels checked, " + result.changed + " fonts restored.");
  } catch (e) { alert("PanelStudio: " + e.message); }
})();
