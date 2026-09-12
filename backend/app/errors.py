from fastapi import HTTPException


def fail(status: int, message: str, code: str = "invalid_request") -> HTTPException:
    return HTTPException(
        status, {"message": message, "type": "gateway_error", "code": code, "param": None}
    )


class UpstreamError(Exception):
    def __init__(self, status: int, code: str = "upstream_error", retry_after: int = 0):
        self.status = status
        self.code = code
        self.retry_after = min(max(retry_after, 0), 3600)
        super().__init__(code)
