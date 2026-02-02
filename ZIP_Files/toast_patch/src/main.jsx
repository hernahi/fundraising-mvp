import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

import FirebaseProvider from "./context/FirebaseProvider.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { CampaignProvider } from "./context/CampaignContext.jsx";
import { ToastProvider } from "./components/useToast.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FirebaseProvider>
      <AuthProvider>
        <CampaignProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </CampaignProvider>
      </AuthProvider>
    </FirebaseProvider>
  </React.StrictMode>
);
