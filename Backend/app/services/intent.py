def classify_intent(message: str) -> str:
    msg = message.lower().strip()

    if any(word in msg for word in ["find", "search", "look up"]):
        return "search"
    if any(word in msg for word in ["stitch", "preview", "grid", "mesh", "colors"]):
        return "visualize"
    if any(word in msg for word in ["make", "create", "generate"]):
        return "generate"
    return "generate"