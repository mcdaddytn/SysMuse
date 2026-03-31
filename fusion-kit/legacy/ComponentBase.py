import adsk.core, adsk.fusion
from typing import List, Dict, Any
from .DesignStepBase import DesignStepBase
from .DesignContext import DesignContext
from .ExtrudeHandlerBase import ExtrudeHandlerBase
from .SketchEnums import DesignStepResult

class ComponentBase(DesignStepBase):
    def __init__(self, name: str, config: dict, design_context: DesignContext):
        super().__init__(name, config, design_context)
        self.extrudes = config.get('extrudes', [])
        self.sketch_name = config.get('sketch_name')

    def execute(self) -> DesignStepResult:
        sketch = self.design_context.namedSketches.get(self.sketch_name)
        if not sketch:
            return DesignStepResult.Error

        self.design_context.active_sketch = sketch

        for extrude_config in self.extrudes:
            extrude_handler = self.design_context.extrude_handlers.get(extrude_config['extrudeType'])
            if extrude_handler:
                extrude_handler._extrude(extrude_config)

        return self.run_dependent_steps()
