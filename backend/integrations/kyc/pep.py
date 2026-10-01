from compliance.constants import (
    PEP_TYPE_ASSOCIATE,
    PEP_TYPE_DOMESTIC,
    PEP_TYPE_FAMILY,
    PEP_TYPE_FOREIGN,
    PEP_TYPE_INTERNATIONAL_ORG,
    PEP_TYPE_NONE,
)

PEP_LABEL = "PEP"

PEP_TYPE_BY_WORD = (
    (("family", "relative"), PEP_TYPE_FAMILY),
    (("associate",), PEP_TYPE_ASSOCIATE),
    (("international", "intl_org"), PEP_TYPE_INTERNATIONAL_ORG),
    (("foreign",), PEP_TYPE_FOREIGN),
    (("domestic",), PEP_TYPE_DOMESTIC),
    (("pep", "politically_exposed"), PEP_TYPE_FOREIGN),
)


def pep_type_of(label) -> str:
    text = str(label).lower()
    for words, pep_type in PEP_TYPE_BY_WORD:
        if any(word in text for word in words):
            return pep_type
    return PEP_TYPE_NONE


def pep_data_from_labels(labels: list) -> dict:
    for label in labels:
        pep_type = pep_type_of(label) if label else PEP_TYPE_NONE
        if pep_type != PEP_TYPE_NONE:
            return {"pep_type": pep_type, "details": labels}
    return {"pep_type": PEP_TYPE_NONE, "details": None}
