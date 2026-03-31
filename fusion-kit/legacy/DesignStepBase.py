from typing import Dict, Any, List
from .DesignContext import DesignContext
from .SketchEnums import DesignStepResult

class DesignStepBase:
    def __init__(self, name: str, config: Dict[str, Any], design_context: DesignContext):
        self.name = name
        self.config = config
        self.design_context = design_context
        self.dependentSteps: List['DesignStepBase'] = []

        # Override design context collections based on the provided configuration
        if 'defaultValues' in config:
            self.design_context.overrideDefaultValues(config['defaultValues'])
        if 'namedParameters' in config:
            self.design_context.overrideNamedParameters(config['namedParameters'])
        if 'namedPoints' in config:
            self.design_context.overrideNamedPoints(config['namedPoints'])

    def execute(self) -> DesignStepResult:
        raise NotImplementedError("Subclasses should implement this method")

    def add_dependent_step(self, step: 'DesignStepBase'):
        self.dependentSteps.append(step)

    def run_dependent_steps(self) -> DesignStepResult:
        for step in self.dependentSteps:
            result = step.execute()
            if result != DesignStepResult.Complete:
                return result
        return DesignStepResult.Complete

    def initialize_from_json(self, json_config: Dict[str, Any]):
        self.config = json_config
        # Pass configuration to subclasses for further initialization if needed
