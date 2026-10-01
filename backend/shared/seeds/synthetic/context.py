from shared.seeds.synthetic.plan import Ref


class Seeded:
    def __init__(self, plan):
        self.plan = plan
        self.users = {}
        self.accounts = {}
        self.companies = {}
        self.transactions = {}
        self.screenings = {}
        self.assets = {}
        self.countries = {}

    def resolve(self, value):
        if isinstance(value, dict):
            return {key: self.resolve(item) for key, item in value.items()}
        if not isinstance(value, Ref):
            return value
        registry = {"company": self.companies, "transaction": self.transactions, "screening": self.screenings}
        return str(registry[value.kind][value.key].pk)
