def classify_intent(message: str) -> str:
    msg = message.lower().strip()

    if msg in {"help", "commands", "what can you do", "what can i do here"}:
        return "help"
    if any(phrase in msg for phrase in ["help ", "guide ", "how do i use"]):
        return "help"
    if any(word in msg for word in ["import", "upload", "url"]):
        return "import"
    if any(word in msg for word in ["undo", "redo", "merge", "paint", "border", "palette", "turn off", "turn on"]):
        return "edit"
    if any(word in msg for word in ["width", "height", "mesh", "contrast", "source", "stitched photo", "photo mode", "graphic art", "screenshot art", "grid"]):
        return "settings"
    if any(word in msg for word in ["stitch", "preview", "grid", "mesh", "colors"]):
        return "visualize"
    if any(word in msg for word in ["finalize", "export", "pdf"]):
        return "finalize"
    if any(word in msg for word in ["make", "create", "generate"]):
        return "generate"
    return "help"
