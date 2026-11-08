from django.http import JsonResponse


class TradingBoundaryMiddleware:

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/v1/trading/"):
            return JsonResponse({"detail": "Trading is disabled."}, status=403)
        return self.get_response(request)
