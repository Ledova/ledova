from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from shared.views.principal import SetsThePrincipalOnTheConnection
from whitelist.serializers import WhitelistStatusSerializer
from whitelist.services import whitelist


class WhitelistStatusView(SetsThePrincipalOnTheConnection, APIView):

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=WhitelistStatusSerializer)
    def get(self, request, token, address):
        share_token = whitelist.share_class_at(token)
        if share_token is None:
            raise Http404("No share class on chain has this contract address.")
        data = whitelist.investor_status(share_token, address)

        return Response(WhitelistStatusSerializer(data).data)
