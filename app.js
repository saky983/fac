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
    setStatus("❌ Error al abrir PDF: " + e.message); return;
  }

  const allItems = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const vp      = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const baseX   = (p - 1) * 5000; // offset por página en eje X

    for (const item of content.items) {
      const str = (item.str || "").trim();
      if (!str) continue;
      // PDF rotado: la coordenada "fila" es X, la "columna" es Y
      allItems.push({
        fila: item.transform[4] + baseX,   // X = qué bomba (fila)
        col:  vp.height - item.transform[5], // Y invertido = qué columna
        str
      });
    }
  }

  setStatus(`🧩 ${allItems.length} elementos, analizando…`);
  procesarItems(allItems);
}

// ── PARSER ────────────────────────────────────────────────────────────────────
// En este PDF rotado:
//   Todas las celdas de una misma bomba comparten el mismo valor de X (fila)
//   Las columnas se identifican por Y:
//     "No. de Tanque" / "SUPER/REGULAR/DIESEL" → col Y ≈ 468/576
//     ID bomba (1,2,3...)  → col Y ≈ 569
//     "Auto Serv."         → col Y ≈ 533
//     DIF USD LECT. DISP.  → col Y ≈ -113 (la más baja)

function procesarItems(allItems) {
  bombas = [];

  // Agrupar por FILA (mismo X ± 8px)
  const filas = [];
  for (const item of allItems) {
    let fila = filas.find(f => Math.abs(f.filaRef - item.fila) <= 8);
    if (!fila) { fila = { filaRef: item.fila, items: [] }; filas.push(fila); }
    fila.items.push(item);
  }

  // Ordenar filas de izquierda a derecha (X creciente)
  filas.sort((a, b) => a.filaRef - b.filaRef);

  let producto = "";

  for (const fila of filas) {
    // Ordenar items dentro de la fila por columna (Y)
    fila.items.sort((a, b) => b.col - a.col); // Y alto = columna izquierda

    const texto = fila.items.map(i => i.str).join(" ").toUpperCase();

    // Detectar cambio de producto — filas que tienen SUPER/REGULAR/DIESEL
    // pero NO tienen "Auto Serv."
    const tieneAuto = fila.items.some(i => /auto/i.test(i.str));
    if (!tieneAuto) {
      if (/\bSUPER\b/.test(texto))   { producto = "S"; continue; }
      if (/\bREGULAR\b/.test(texto)) { producto = "R"; continue; }
      if (/\bDIESEL\b/.test(texto))  { producto = "D"; continue; }
    }

    if (!producto) continue;
    if (!tieneAuto) continue;

    // ID de bomba: número 1-50 en col Y entre 550 y 590
    const idItem = fila.items.find(i => {
      const col = i.col;
      return col >= 550 && col <= 590 && /^\d+$/.test(i.str.trim());
    });
    if (!idItem) continue;
    const bomba = parseInt(idItem.str.trim(), 10);
    if (bomba < 1 || bomba > 50) continue;

    // DIF USD: item con col Y más bajo (más negativo = última columna)
    const difItem = fila.items.reduce((min, i) => i.col < min.col ? i : min, fila.items[0]);
    const monto = parseFloat(difItem.str.replace(/[$,\s]/g, ""));
    if (isNaN(monto)) continue;

    bombas.push({ bomba, sabor: producto, monto });
  }

  if (!bombas.length) {
    setStatus("⚠️ No se detectaron bombas.");
  } else {
    setStatus(`✅ ${bombas.length} bombas detectadas.`);
  }
  mostrarBombas();
}

// ── MOSTRAR BOMBAS ────────────────────────────────────────────────────────────
function mostrarBombas() {
  const grupos  = { S: [], R: [], D: [] };
  const nombres = { S: "⛽ SUPER", R: "🔵 REGULAR", D: "🟡 DIESEL" };
  bombas.forEach(b => grupos[b.sabor].push(b));

  let html = "";
  ["S","R","D"].forEach(tipo => {
    if (!grupos[tipo].length) return;
    html += `<div class="grupo">
      <h3>${nombres[tipo]}</h3>
      <table>
        <thead><tr><th>Bomba</th><th>USD Diferencia</th></tr></thead>
        <tbody>`;
    grupos[tipo].forEach(b => {
      const cls = b.monto < 0 ? "negativo" : "";
      html += `<tr class="${cls}"><td>Bomba ${b.bomba}</td><td>$${b.monto.toFixed(2)}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  });
  document.getElementById("resultado").innerHTML = html;
}

// ── GENERAR FACTURAS ──────────────────────────────────────────────────────────
// ── COMPENSAR NEGATIVOS ────────────────────────────────────────────────────────────────────────────
// Cada bomba negativa descuenta de la positiva más cercana en monto,
// del mismo tipo de combustible.
function compensarNegativos(listaBombas) {
  const montos = listaBombas.map(b => ({ ...b, monto: Math.round(b.monto * 100) / 100 }));
  const negativos = montos.filter(b => b.monto < 0);

  negativos.forEach(neg => {
    const valorNeg = Math.abs(neg.monto);

    // Buscar positiva del mismo sabor con monto >= al negativo,
    // la más cercana (menor diferencia) a ese valor
    const positivas = montos
      .filter(b => b.sabor === neg.sabor && b.monto >= valorNeg)
      .sort((a, b) => (a.monto - valorNeg) - (b.monto - valorNeg));

    if (positivas.length > 0) {
      // Encontró una que alcanza — le resta exactamente el valor negativo
      // dejando ese monto sin facturar
      positivas[0].monto = Math.round((positivas[0].monto - valorNeg) * 100) / 100;
    }

    // La negativa queda en 0 — no genera factura
    neg.monto = 0;
  });

  return montos.filter(b => b.monto > 0);
}

function generarFacturas(soloPositivas = false) {
  if (!bombas.length) { alert("Primero lee el PDF."); return; }

  const bacInput  = parseFloat(document.getElementById("montoBAC").value) || 0;
  facturas        = [];
  let bacRestante = Math.round(bacInput * 100) / 100;
  const RESERVA   = 100.00;

  // Compensar negativos antes de facturar
  const bombasCompensadas = compensarNegativos(bombas);
  const bombasAUsar = soloPositivas
    ? bombasCompensadas.filter(b => b.monto > 0)
    : bombasCompensadas;

  const totalPorSabor = { S: 0, R: 0, D: 0 };
  bombasAUsar.forEach(b => { if (b.monto > 0) totalPorSabor[b.sabor] += b.monto; });

  const facturable = {};
  ["S","R","D"].forEach(s => {
    facturable[s] = Math.max(0, Math.round((totalPorSabor[s] - RESERVA) * 100) / 100);
  });
  const restante  = { ...facturable };
  const totalFact = Object.values(facturable).reduce((s,v) => s+v, 0);

  if (bacRestante > totalFact + 0.01) {
    alert(`⚠️ BAC ($${bacRestante.toFixed(2)}) supera facturable ($${totalFact.toFixed(2)})`);
    return;
  }

  bombasAUsar.forEach(b => {
    let monto = Math.min(Math.round(b.monto * 100) / 100, restante[b.sabor]);
    monto = Math.round(monto * 100) / 100;
    if (monto <= 0) return;
    restante[b.sabor] = Math.round((restante[b.sabor] - monto) * 100) / 100;

    if (bacRestante > 0) {
      let bac = Math.min(monto, bacRestante);
      bac = Math.round(bac * 100) / 100;
      bacRestante = Math.round((bacRestante - bac) * 100) / 100;
      let tmp = bac;
      while (tmp > 60) { facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: 60, metodo: "B" }); tmp = Math.round((tmp-60)*100)/100; }
      if (tmp > 0) facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: tmp, metodo: "B" });
      monto = Math.round((monto - bac) * 100) / 100;
    }

    if (monto <= 0) return;
    let tmp = monto;
    while (tmp > 60) { facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: 60, metodo: "E" }); tmp = Math.round((tmp-60)*100)/100; }
    if (tmp > 0) facturas.push({ bomba: b.bomba, sabor: b.sabor, monto: tmp, metodo: "E" });
  });

  const tB = facturas.filter(f=>f.metodo==="B").reduce((s,f)=>s+f.monto,0);
  const tE = facturas.filter(f=>f.metodo==="E").reduce((s,f)=>s+f.monto,0);
  const rS = Math.min(totalPorSabor.S, RESERVA).toFixed(2);
  const rR = Math.min(totalPorSabor.R, RESERVA).toFixed(2);
  const rD = Math.min(totalPorSabor.D, RESERVA).toFixed(2);
  setStatus(`✅ ${facturas.length} facturas${soloPositivas?" [Solo+]":""} — BAC:$${tB.toFixed(2)} | EF:$${tE.toFixed(2)} | Sin facturar→ S:$${rS} R:$${rR} D:$${rD}`);
  mostrarFacturas();
}

// ── MOSTRAR FACTURAS ──────────────────────────────────────────────────────────
function mostrarFacturas() {
  const grupos  = { S: [], R: [], D: [] };
  const nombres = { S: "⛽ SUPER", R: "🔵 REGULAR", D: "🟡 DIESEL" };
  facturas.forEach(f => grupos[f.sabor].push(f));

  let html = "";
  ["S","R","D"].forEach(tipo => {
    if (!grupos[tipo].length) return;
    const total = grupos[tipo].reduce((s,f) => s+f.monto, 0);
    const cntB  = grupos[tipo].filter(f=>f.metodo==="B").length;
    const cntE  = grupos[tipo].filter(f=>f.metodo==="E").length;
    html += `<div class="grupo">
      <h3>${nombres[tipo]} — ${grupos[tipo].length} facturas · $${total.toFixed(2)}
        <span class="badge bac">BAC ${cntB}</span>
        <span class="badge ef">EF ${cntE}</span>
      </h3>
      <table>
        <thead><tr><th>Bomba</th><th>Método</th><th>Monto</th></tr></thead>
        <tbody>`;
    grupos[tipo].forEach(f => {
      html += `<tr class="${f.metodo==="B"?"fila-bac":"fila-ef"}">
        <td>Bomba ${f.bomba}</td>
        <td><span class="badge ${f.metodo==="B"?"bac":"ef"}">${f.metodo==="B"?"BAC":"Efectivo"}</span></td>
        <td>$${f.monto.toFixed(2)}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });
  document.getElementById("resultado").innerHTML = html;
}

// ── EXPORTAR TXT ──────────────────────────────────────────────────────────────
function exportar() {
  if (!facturas.length) { alert("Primero genera las facturas."); return; }
  let txt = "";
  facturas.forEach(f => { txt += `${f.bomba},${f.sabor},${f.monto.toFixed(2)},${f.metodo}\n`; });
  const blob = new Blob([txt], { type: "text/plain" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = "facturas.txt";
  a.click();
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}
