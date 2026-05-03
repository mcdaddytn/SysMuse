"""
fusionkit.components
Component registry: maps JSON type names to Python component classes.
"""

import typing

from fusionkit.components.component_base import ComponentBase
from fusionkit.components.pipe_clamp import PipeClamp
from fusionkit.components.luna_wrench import LunaWrench, DoubleSidedLunaWrench
from fusionkit.components.hi_hat_cylinder import HiHatCylinder
from fusionkit.components.mounting_plate import MountingPlate
from fusionkit.components.slider_rail import SliderRail
from fusionkit.components.slider_carriage import SliderCarriage


# Registry of all available component types.
COMPONENT_REGISTRY: typing.Dict[str, typing.Type[ComponentBase]] = {
    'PipeClamp': PipeClamp,
    'LunaWrench': LunaWrench,
    'DoubleSidedLunaWrench': DoubleSidedLunaWrench,
    'HiHatCylinder': HiHatCylinder,
    'MountingPlate': MountingPlate,
    'SliderRail': SliderRail,
    'SliderCarriage': SliderCarriage,
}


def get_component_class(type_name: str) -> typing.Type[ComponentBase]:
    """Look up a component class by its type name."""
    cls: typing.Optional[typing.Type[ComponentBase]] = COMPONENT_REGISTRY.get(type_name)
    if cls is None:
        available: str = ', '.join(COMPONENT_REGISTRY.keys())
        raise KeyError(f"Unknown component type '{type_name}'. Available: {available}")
    return cls
