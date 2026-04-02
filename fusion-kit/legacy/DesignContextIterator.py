from .DesignContext import DesignContext

class DesignContextIterator:
    def __init__(self, design_context: DesignContext):
        self.design_context = design_context

    def getContext(self) -> DesignContext:
        return self.design_context

    def next(self) -> bool:
        raise NotImplementedError("Subclasses should implement this method")

class PointIterator(DesignContextIterator):
    def __init__(self, design_context: DesignContext, pointName: str, points: list):
        super().__init__(design_context)
        self.pointName = pointName
        self.points = points
        self.current_index = 0

    def next(self) -> bool:
        if self.current_index < len(self.points):
            self.design_context.update_named_point(self.pointName, self.points[self.current_index])
            self.current_index += 1
            return True
        return False
