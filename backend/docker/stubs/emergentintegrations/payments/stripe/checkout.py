class CheckoutSessionRequest:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


class StripeCheckout:
    def __init__(self, api_key=None, webhook_url=None, **_kwargs):
        self.api_key = api_key
        self.webhook_url = webhook_url

    async def create_checkout_session(self, _req):
        raise RuntimeError("Stripe (emergentintegrations) is not installed in this image")

    async def get_checkout_status(self, session_id: str):
        class _Status:
            payment_status = "pending"
            status = "open"
            session_id = None

        st = _Status()
        st.session_id = session_id
        return st

    async def handle_webhook(self, _body, _signature):
        raise RuntimeError("Stripe (emergentintegrations) is not installed in this image")
