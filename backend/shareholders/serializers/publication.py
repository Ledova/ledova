from rest_framework import serializers

from shareholders.models import Publication


class PublicationSerializer(serializers.ModelSerializer):
    shares = serializers.DecimalField(
        source="holding", max_digits=78, decimal_places=0, read_only=True, allow_null=True
    )

    class Meta:
        model = Publication
        fields = [
            "uuid",
            "kind",
            "title",
            "company_name",
            "token_name",
            "token_symbol",
            "record_date",
            "shares",
            "created_at",
        ]
        read_only_fields = fields
