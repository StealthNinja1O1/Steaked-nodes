"""
Text Concat Node
================
Concatenates an incoming text string with a locally-typed text field.
A toggle controls which part comes first.
"""


class TextConcat:
    """Joins an input text STRING with a built-in text field."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
                "order": (["input first", "text first"],),
                "separator": ("STRING", {"default": ", "}),
            },
            "optional": {
                "input_text": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("combined",)
    FUNCTION = "execute"
    CATEGORY = "Steaked-nodes/tools"
    DESCRIPTION = (
        "Concatenates an input text stream with a typed text field. "
        "Use 'order' to choose which part appears first."
    )

    def execute(self, text: str, order: str, separator: str, input_text: str = ""):
        a = (input_text or "").strip()
        b = (text or "").strip()

        if order == "text first":
            parts = [b, a]
        else:  # "input first"
            parts = [a, b]

        combined = separator.join(p for p in parts if p)
        return (combined,)
