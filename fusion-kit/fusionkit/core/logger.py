"""
fusionkit.core.logger
Logging with configurable file output and optional Fusion 360 UI message box output.
"""

import adsk.core
import logging
import typing
from datetime import datetime

from fusionkit.core.enums import LogLevel


class FusionLogger:
    """
    Logger that writes to a log file and optionally shows messages
    in the Fusion 360 UI based on configurable thresholds.
    """

    def __init__(self, ui: adsk.core.UserInterface,
                 log_dir: str = '/tmp/fusionkit/logs',
                 log_name: str = 'fusionkit',
                 file_threshold: LogLevel = LogLevel.INFO,
                 ui_threshold: LogLevel = LogLevel.NONE) -> None:
        self.ui: adsk.core.UserInterface = ui
        self.file_threshold: LogLevel = file_threshold
        self.ui_threshold: LogLevel = ui_threshold
        self._logger: typing.Optional[logging.Logger] = None

        self._init_file_logger(log_dir, log_name)

    def _init_file_logger(self, log_dir: str, log_name: str) -> None:
        """Initialize the Python file logger."""
        try:
            timestamp: str = datetime.now().strftime('%Y%m%d_%H%M%S')
            log_path: str = f"{log_dir}/{log_name}_{timestamp}.log"
            log_format: str = '%(asctime)s - %(levelname)s - %(message)s'

            self._logger = logging.getLogger(log_name)
            self._logger.setLevel(logging.DEBUG)

            handler: logging.FileHandler = logging.FileHandler(log_path, mode='w')
            handler.setFormatter(logging.Formatter(log_format))
            self._logger.addHandler(handler)

            self._logger.info(f"Logger initialized: {log_path}")
        except Exception:
            # If logging setup fails (e.g., directory doesn't exist),
            # continue without file logging
            self._logger = None

    def log(self, level: LogLevel, msg: str) -> None:
        """Log a message at the specified level."""
        if level == LogLevel.NONE:
            return

        # File logging
        if self._logger and level.value >= self.file_threshold.value:
            self._logger.log(level.value, msg)

        # UI logging
        if level.value >= self.ui_threshold.value and self.ui_threshold != LogLevel.NONE:
            self.ui.messageBox(f"[{level.name}] {msg}")

    def debug(self, msg: str) -> None:
        self.log(LogLevel.DEBUG, msg)

    def info(self, msg: str) -> None:
        self.log(LogLevel.INFO, msg)

    def warning(self, msg: str) -> None:
        self.log(LogLevel.WARNING, msg)

    def error(self, msg: str) -> None:
        self.log(LogLevel.ERROR, msg)

    def critical(self, msg: str) -> None:
        self.log(LogLevel.CRITICAL, msg)
