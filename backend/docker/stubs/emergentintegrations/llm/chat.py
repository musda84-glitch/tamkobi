class UserMessage:
    def __init__(self, text: str = "", **_kwargs):
        self.text = text


class LlmChat:
    def __init__(self, api_key=None, session_id=None, system_message=None, **_kwargs):
        self.api_key = api_key
        self.session_id = session_id
        self.system_message = system_message

    def with_model(self, *_args, **_kwargs):
        return self

    async def send_message(self, _msg):
        raise RuntimeError("emergentintegrations SDK is not installed in this image")
