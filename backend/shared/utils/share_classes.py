def share_class_label(row):
    if row.share_class_symbol is None:
        return None
    return f"{row.share_class_symbol} ({row.share_class_company_name})"
