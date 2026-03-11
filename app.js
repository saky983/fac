let bombas   = [];
let facturas = [];

// ── LEER PDF ──────────────────────────────────────────────────────────────────
async function leerPDF() {
  const file = document.getElementById("pdfFile").files[0];
  if (!file) { alert("Selecciona un archivo PDF primero."); return; }

  setStatus("📄 Cargando archivo…");

  const typedarray = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsArrayBuffer(file);
  });

  setStatus("🔍 Procesando PDF…");

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
  } catch (e) {
    setStatus("❌ Error al abrir PDF: " + e.message);
    return;
  }

  setStatus(`📑 ${pdf.numPages} páginas, extrayendo…`);

  const allItems = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const vp      = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const baseY   = (p - 1) * 5000;

    for (const item of content.items) {
      const str = (item.str || "").trim();
      if (!str) continue;
      allItems.push({
        x: item.transform[4],
        y: (vp.height - item.transform[5]) + baseY,
        str
      });
    }
  }

  // ── DEBUG: mostrar primeros 60 items con sus coordenadas ──────────────────
  let dbg = "=== DEBUG PRIMEROS 60 ITEMS ===\n";
  allItems.slice(0, 60).forEach(i => {
    dbg += `x=${Math.round(i.x)} y=${Math.round(i.y)} | "${i.str}"\n`;
  });
  document.getElementById("resultado").innerHTML =
    `<pre style="color:#f5a623;font-size:11px;overflow:auto;max-height:400px;background:#0d0f12;padding:12px;border-radius:4px">${dbg}</pre>`;

  setStatus(`🧩 ${allItems.length} elementos. Revisa las coordenadas abajo y mándame captura.`);
}

function mostrarBombas() {}
function generarFacturas() {}
function mostrarFacturas() {}
function exportar() {}
function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}
