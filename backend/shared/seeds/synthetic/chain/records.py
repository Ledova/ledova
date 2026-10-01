from uuid import UUID

from django.contrib.auth import get_user_model
from django.utils import timezone

from offerings.tasks import allot_subscription_task
from shared.constants import BLOCKCHAIN_BASE
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.chain.population import postal_address
from shared.seeds.synthetic.identities import EMAIL_DOMAIN
from shared.seeds.synthetic.story import STAFF
from tokens.tasks import deploy_share_token_task, execute_review_request_task
from tokens.tasks.deployment import recover_swap_approval
from tokens.tasks.pause import recover_pause_change
from users.models import Notification, UserAccount
from users.tasks.notifications import send_push_notification
from wallets.models import Wallet

User = get_user_model()


def member_id(company, holder):
    return UUID(bytes=keys.secret("member", company, holder)[:16], version=4)


class Records:
    def __init__(self, plan, companies, deferrals):
        self.plan = plan
        self.companies = companies
        self.deferrals = deferrals
        self.staff = {
            key: User.objects.get(email=f"{handle}@{EMAIL_DOMAIN}") for key, handle, _, _, left in STAFF if not left
        }
        self.classes = {}
        self.offerings = {}
        self.subscriptions = {}
        self.entries = {}
        self.audy = None
        self.holders = {}
        for share_class in plan.classes:
            for position in share_class.positions:
                self.holders[(share_class.company, position.address.lower())] = position.holder
        for item in plan.rounds:
            company = plan.share_class(item.share_class).company
            for application in item.applications:
                self.holders.setdefault((company, application.address.lower()), application.investor)
        for request in plan.requests:
            company = plan.share_class(request.share_class).company
            self.holders.setdefault((company, request.address.lower()), request.holder)

    @property
    def operations(self):
        return self.staff["operations"]

    @property
    def documents(self):
        return self.staff["documents"]

    def user(self, key):
        return User.objects.get(email=key)

    def account(self, key):
        return UserAccount.objects.get(user_profile__user__email=key)

    def owner(self, company):
        return self.companies[company].owner

    def company_key(self, company_id):
        return next(key for key, company in self.companies.items() if company.pk == company_id)

    def postal_address(self, company):
        return postal_address(self.companies[company])

    def wallet(self, key, address):
        return Wallet.objects.filter_by_address(address, chain=BLOCKCHAIN_BASE).get(
            user_account__user_profile__user__email=key
        )

    def member(self, company, address):
        return member_id(company, self.holders[(company, address.lower())])

    def run(self):
        return self.deferrals.run(
            {
                deploy_share_token_task.name: deploy_share_token_task,
                recover_swap_approval.name: recover_swap_approval,
                execute_review_request_task.name: execute_review_request_task,
                allot_subscription_task.name: allot_subscription_task,
                recover_pause_change.name: recover_pause_change,
                send_push_notification.name: self.notify,
            }
        )

    def notify(self, user_id, title, body, data=None, notification_type="general"):
        user = User.objects.get(pk=user_id)
        moment = timezone.now()
        read = user.last_login is not None and moment < user.last_login
        Notification.objects.create(
            user=user,
            title=title,
            body=body,
            notification_type=notification_type,
            data=data or {},
            is_read=read,
            read_at=min(user.last_login, moment + (user.last_login - moment) / 3) if read else None,
        )
        return {"status": "recorded"}
