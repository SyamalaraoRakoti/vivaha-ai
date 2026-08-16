/* ==========================================================================
   Vivaha AI — deployment configuration
   --------------------------------------------------------------------------
   The Gemini API key and the Google Sheet URL live on the backend (Render),
   NOT here — so visitors can open the site and run the pipeline without a key.

   Steps after deploying the backend:
     1. Deploy the server/ folder to Render (see README.md).
     2. Copy your Render service URL (e.g. https://vivaha-ai-api.onrender.com)
        into API_BASE below and set USE_BACKEND to true.
   ========================================================================== */

const CONFIG = {
  // The backend service URL. Leave as "" until you deploy the backend.
  API_BASE: "",

  // true  → all Gemini + Google Sheets traffic goes through the backend
  //         (no API key or sheet URL needed by visitors).
  // false → direct browser-to-Gemini calls (for local testing only; the
  //         visitor must supply their own Gemini key in the UI).
  USE_BACKEND: true,

  // Only used when USE_BACKEND is false.
  DEFAULT_MODEL: "gemini-2.5-flash",
};
