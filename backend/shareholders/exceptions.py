from rest_framework import status
from rest_framework.exceptions import APIException

NO_PUBLICATION = "No publication was found."


class PublicationNotDelivered(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "This publication could not be delivered because its read could not be recorded. "
        "A delivery that leaves no audit record is refused rather than served."
    )
    default_code = "publication_read_unrecorded"
    expose_code = True


class PublicationUnopened(PublicationNotDelivered):
    default_detail = (
        "This publication could not be delivered because its stored document could not be opened. "
        "Nothing was served and no read was recorded."
    )
    default_code = "publication_unopened"


class PublicationIntegrityError(Exception):
    pass
