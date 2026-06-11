const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function startKeepAlive(intervalMinutes = 10) {
  const ping = () => {
    fetch(`${API_URL}/health`, { method: "GET" })
      .then(() => console.log("[KeepAlive] Backend activo"))
      .catch(() => console.warn("[KeepAlive] Backend dormido, despertando..."));
  };

  ping(); // ping inmediato al cargar
  const id = setInterval(ping, intervalMinutes * 60 * 1000);
  return () => clearInterval(id);
}
