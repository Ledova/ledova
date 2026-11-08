import hashlib


def _refuse_resource(url, **kwargs):
    raise ValueError("PDF resources must not be loaded from URLs.")


def render_pdf(pages):
    from weasyprint import CSS, HTML
    from weasyprint.text.fonts import FontConfiguration

    pages = list(pages)
    if not pages:
        raise ValueError("A PDF must contain at least one page.")
    font_config = FontConfiguration()
    rendered = []
    for content in pages:
        for size in (10, 8, 6, 4, 2, 1, 0.5, 0.25, 0.125):
            style = CSS(string=f"""
                @page {{ size: A4; margin: 56pt; }}
                body {{ font: {size}pt "Noto Sans", sans-serif; line-height: 1.25; }}
                p {{ margin: .6em 0; overflow-wrap: anywhere; }}
                h1 {{ font-size: 2em; margin: .5em 0; }}
                h2 {{ font-size: 1.3em; margin: .6em 0; }}
                .signature, .notice {{ font-size: .85em; }}
                """)
            document = HTML(string=content, url_fetcher=_refuse_resource).render(
                stylesheets=[style], font_config=font_config
            )
            if len(document.pages) == 1:
                break
        else:
            raise ValueError("The PDF content cannot fit on its page.")
        rendered.extend(document.pages)
    identifier = hashlib.sha256("\n".join(pages).encode()).hexdigest().encode()
    return document.copy(rendered).write_pdf(pdf_identifier=identifier)
