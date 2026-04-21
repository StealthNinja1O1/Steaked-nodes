"""
Any Switch Node
A dynamic switch that can handle any input type with unlimited inputs
"""


class AnyType(str):
    """A special string that matches any type for ComfyUI's type system."""
    
    def __eq__(self, __value: object) -> bool:
        return True
    
    def __ne__(self, __value: object) -> bool:
        return False

any_type = AnyType("*")


class AnySwitch:
    """
    Dynamic switch that automatically adds input slots as needed.
    Works with any data type and provides unlimited inputs.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "index": ("INT", {
                    "default": 0, 
                    "min": 0, 
                    "max": 999,
                    "step": 1,
                    "display": "number"
                }),
            },
            "optional": {
                "input_01": (any_type,),
                "input_02": (any_type,),
                "input_03": (any_type,),
                "input_04": (any_type,),
                "input_05": (any_type,),
            }
        }
    
    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("output",)
    FUNCTION = "switch"
    CATEGORY = "Steaked-nodes/logic"
    OUTPUT_IS_LIST = (False,)
    
    @classmethod
    def VALIDATE_INPUTS(cls, index, **kwargs):
        """Validate inputs and help ComfyUI resolve types."""
        return True
    
    def switch(self, index, **kwargs):
        """
        Select and return the input at the specified index.
        """
        # Collect all inputs that start with 'input_' in order
        inputs = []
        input_keys = []
        for key in sorted(kwargs.keys()):
            if key.startswith('input_'):
                value = kwargs[key]
                if value is not None:
                    inputs.append(value)
                    input_keys.append(key)
        if not inputs:
            return (None,)
        selected_index = max(0, min(index, len(inputs) - 1))
        
        return (inputs[selected_index],)


NODE_CLASS_MAPPINGS = {
    "AnySwitch": AnySwitch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnySwitch": "Any Switch",
}
