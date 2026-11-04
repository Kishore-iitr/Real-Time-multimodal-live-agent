import sys
import os

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print("\n" + "=" * 60)
    print("[*] Launching Gemini Vision-Agents Conversational App")
    print(f"[*] Open in your browser: http://localhost:{port}")
    print("=" * 60 + "\n")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
