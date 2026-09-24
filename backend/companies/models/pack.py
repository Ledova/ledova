from companies.models.company import Company


class CompanyPack(Company):
    class Meta:
        proxy = True
        verbose_name = "company pack"
        verbose_name_plural = "company packs"
