"""Çok adımlı finans yazmalarında ters sırayla geri alma (compensating transaction)."""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, List, Optional

logger = logging.getLogger("finance_txn")

UndoFn = Callable[[], Awaitable[Any]]


class CompensatingTxn:
    """Başarılı adımları kaydeder; hata olursa ters sırayla undo çağırır."""

    def __init__(self, label: str = "finance"):
        self.label = label
        self._undos: List[UndoFn] = []
        self._done: List[str] = []

    def push(self, name: str, undo: UndoFn) -> None:
        self._undos.append(undo)
        self._done.append(name)

    async def rollback(self, exc: Optional[BaseException] = None) -> None:
        if not self._undos:
            return
        logger.error(
            "Finans işlemi geri alınıyor (%s): adımlar=%s hata=%s",
            self.label,
            list(reversed(self._done)),
            exc,
            exc_info=exc is not None,
        )
        while self._undos:
            name = self._done.pop()
            undo = self._undos.pop()
            try:
                await undo()
            except Exception:
                logger.exception(
                    "Finans geri alma adımı başarısız (%s · %s)", self.label, name
                )

    async def run(self, body: Callable[["CompensatingTxn"], Awaitable[Any]]) -> Any:
        try:
            return await body(self)
        except Exception as exc:
            await self.rollback(exc)
            raise
