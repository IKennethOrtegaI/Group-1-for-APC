import axios from "axios";

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  timeout: 300000,
});

export const trainModel = (dataset, model_name) =>
  API.post("/models/train", { dataset, model_name });

export const getTrainStatus = (dataset, model_name) =>
  API.get(`/models/train/status/${dataset}/${model_name}`);

export const predict = (dataset, model_name, features) =>
  API.post("/models/predict", { dataset, model_name, features });

export const getMetrics = (dataset, model_name) =>
  API.get(`/models/metrics/${dataset}/${model_name}`);

export const compareModels = (dataset) =>
  API.get(`/models/compare/${dataset}`);

export const getAlerts = (limit = 50) =>
  API.get(`/alerts/?limit=${limit}`);

export const getAlertStats = () =>
  API.get("/alerts/stats");

export const uploadCSV = (file, dataset, model_name) => {
  const form = new FormData();
  form.append("file", file);
  return API.post(`/alerts/upload-csv?dataset=${dataset}&model_name=${model_name}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};
