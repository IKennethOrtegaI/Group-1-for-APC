import { useState, useRef } from "react";
import { uploadCSV } from "../api/client";
import { Upload, FileText, Download } from "lucide-react";

export default function BatchUpload({ onDone }) {
  const [dataset, setDataset] = useState("nslkdd");
  const [model, setModel] = useState("random_forest");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  const process = async (file) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadCSV(file, dataset, model);
      setResult({ ...res.data, filename: file.name });
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.detail || "Error al procesar el archivo.");
    } finally { setLoading(false); }
  };

  const handleFile = (e) => { const f = e.target.files?.[0]; if (f) process(f); };
  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f?.name.endsWith(".csv")) process(f);
  };

  return (
    <div className="rounded-xl p-6" style={{ background: "#161b22", border: "1px solid #21262d" }}>
      <div className="mb-5">
        <h2 className="text-base font-bold" style={{ color: "#e6edf3" }}>Predicción Masiva vía Archivo (CSV)</h2>
        <p className="text-[12px] mt-1" style={{ color: "#8b949e" }}>Analiza miles de registros de red simultáneamente</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5" style={{ color: "#8b949e" }}>Dataset</label>
          <select value={dataset} onChange={(e) => setDataset(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3" }}>
            <option value="nslkdd">NSL-KDD</option>
            <option value="cicids">CICIDS2017</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5" style={{ color: "#8b949e" }}>Modelo</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3" }}>
            <option value="random_forest">Random Forest</option>
            <option value="xgboost">XGBoost</option>
          </select>
        </div>
      </div>

      <div
        onClick={() => !loading && fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className="rounded-xl flex flex-col items-center justify-center py-10 cursor-pointer transition-all"
        style={{
          border: `2px dashed ${dragging ? "#1d6fe6" : "#30363d"}`,
          background: dragging ? "rgba(29,111,230,0.05)" : "#0d1117",
        }}>
        <Upload size={28} className="mb-3" style={{ color: dragging ? "#58a6ff" : "#484f58" }} />
        <p className="text-[13px] font-medium" style={{ color: dragging ? "#58a6ff" : "#8b949e" }}>
          {loading ? "Procesando archivo..." : "Arrastra tu archivo CSV aquí o Haz clic para subir"}
        </p>
        <p className="text-[11px] mt-1.5" style={{ color: "#484f58" }}>
          Soporta formatos basados en NSL-KDD y CICIDS2017 (.csv)
        </p>
      </div>
      <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />

      {error && (
        <div className="mt-3 p-3 rounded-lg text-[12px] fade-in" style={{ background: "rgba(248,81,73,0.06)", border: "1px solid rgba(248,81,73,0.2)", color: "#f85149" }}>
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl p-4 fade-in" style={{ background: "#0d1117", border: "1px solid #21262d" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText size={14} style={{ color: "#58a6ff" }} />
              <span className="text-[12px] font-semibold" style={{ color: "#58a6ff" }}>
                Reporte del Lote — {result.filename}
              </span>
            </div>
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
              style={{ background: "rgba(29,111,230,0.1)", border: "1px solid rgba(29,111,230,0.3)", color: "#58a6ff" }}>
              <Download size={11} /> Descargar Reporte PDF
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="p-3 rounded-lg" style={{ background: "#161b22", border: "1px solid #21262d" }}>
              <p style={{ color: "#8b949e" }}>Registros Procesados</p>
              <p className="text-[20px] font-bold mt-0.5" style={{ color: "#58a6ff" }}>{result.total_records?.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: "rgba(248,81,73,0.06)", border: "1px solid rgba(248,81,73,0.2)" }}>
              <p style={{ color: "#8b949e" }}>Ataques Encontrados</p>
              <p className="text-[20px] font-bold mt-0.5" style={{ color: "#f85149" }}>{result.attacks_detected?.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: "rgba(63,185,80,0.06)", border: "1px solid rgba(63,185,80,0.15)" }}>
              <p style={{ color: "#8b949e" }}>Tráfico Normal</p>
              <p className="text-[20px] font-bold mt-0.5" style={{ color: "#3fb950" }}>{result.normal_traffic?.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: "rgba(210,153,34,0.06)", border: "1px solid rgba(210,153,34,0.2)" }}>
              <p style={{ color: "#8b949e" }}>Tasa de Ataque</p>
              <p className="text-[20px] font-bold mt-0.5" style={{ color: "#d29922" }}>{(result.attack_rate * 100).toFixed(1)}%</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
