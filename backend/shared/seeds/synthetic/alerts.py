from datetime import timedelta

from compliance.seeds.monitoring_rules import MONITORING_RULES
from compliance.services.transaction_monitoring import RULE_CODE_TO_ALERT_TYPE
from shared.seeds.synthetic.plan import AlertPlan, Ref

RULES = {rule["rule_code"]: rule for rule in MONITORING_RULES}
ROLE_CHAINS = {
    "large_deposit": "ethereum",
    "sof_deposit": "ethereum",
    "structuring": "ethereum",
    "screened_send": "bitcoin",
}
SCREENING_FAILURE = "Crypto monitoring is disabled"
MANUAL = "MANUAL"


class AlertBook:
    def __init__(self, story):
        self.story = story
        self.subjects = {}
        self.labelled = {}
        self.recorded = {}
        self.changes = {}

    def chain_for(self, role):
        return ROLE_CHAINS.get(role)

    def subject(self, role, person):
        self.subjects[role] = person.key

    def account_change(self, role):
        self.changes[role] = self.story.moment(36 if role == "suspended" else 52, 10, 16)
        return self.changes[role]

    def activity_end(self, role):
        return self.story.moment(128) if role == "dormant" else None

    def forced_events(self, role, wallet):
        story = self.story
        native = "BTC" if wallet.chain == "bitcoin" else "ETH"
        if role == "large_deposit":
            return [(story.moment(121, 9, 16), ("USDC", True, 18500, False, "large_deposit"))]
        if role == "sof_deposit":
            return [(story.moment(71, 9, 16), ("USDT", True, 12000, False, "sof_deposit"))]
        if role == "structuring":
            return [
                (story.moment(days, 9, 17), ("USDC", True, story.rng.uniform(8250, 9880), False, f"structuring-{n}"))
                for n, days in enumerate((104, 103, 101))
            ]
        if role == "screened_send":
            return [
                (story.moment(49, 9, 16), ("BTC", True, 9200, False, None)),
                (story.moment(46, 9, 16), ("BTC", False, 6200, True, "screened_send")),
            ]
        if role == "high_volume":
            directions = (True, True, False, True, False, True, False, True)
            return [
                (story.moment(days, 8, 20), (native, incoming, story.rng.uniform(6000, 7800), None, f"volume-{n}"))
                for n, (days, incoming) in enumerate(zip((27, 24, 21, 17, 13, 10, 7, 4), directions))
            ]
        if role == "dormant":
            return [(story.moment(2, 9, 12), (native, True, 6000, False, "dormant"))]
        if role == "rapid":
            start = story.moment(31, 10, 13)
            events = [(story.moment(33, 9, 12), (native, True, 5000, False, None))]
            for n, minutes in enumerate((0, 9, 17, 31, 48)):
                spec = (native, False, story.rng.uniform(300, 900), True, f"rapid-{n}")
                events.append((start + timedelta(minutes=minutes), spec))
            return events
        return []

    def label(self, label, transfer):
        self.labelled[label] = transfer

    def record(self, role, transfers):
        if role:
            self.recorded[role] = transfers

    def plans(self):
        builders = (
            self._large_deposit,
            self._sof_deposit,
            self._screened_send,
            self._high_volume,
            self._structuring,
            self._dormant,
            self._rapid,
            self._media,
            self._discrepancy,
            self._terminated,
            self._suspended,
        )
        alerts = []
        for builder in builders:
            alerts.extend(builder())
        return tuple(sorted(alerts, key=lambda alert: alert.created_at))

    def _rule(self, code, **fields):
        rule = RULES[code]
        return dict(
            rule=code,
            alert_type=RULE_CODE_TO_ALERT_TYPE[code],
            severity=rule["alert_severity"],
            description=f"{rule['name']}: {rule['description']}",
            **fields,
        )

    def _closed(self, created, outcome, notes, assignee="compliance", low=600, high=2880):
        story = self.story
        return dict(
            created_at=created,
            status="closed",
            assignee=assignee,
            assigned_at=story.after(created, 30, 300),
            resolver=assignee,
            resolved_at=story.after(created, low, high),
            outcome=outcome,
            notes=notes,
        )

    def _monitored(self, transfer):
        return transfer.at + timedelta(seconds=self.story.rng.randint(40, 200))

    def _batched(self, transfer):
        return transfer.at + timedelta(minutes=self.story.rng.randint(8, 58))

    def _large(self, person, transfer, notes):
        data = {"amount": float(transfer.market_value), "threshold": 10000.0, "currency": "AUD"}
        closed = self._closed(self._monitored(transfer), "legitimate_activity", notes)
        return AlertPlan(person=person, data=data, transfer=transfer.tx_hash, **self._rule("MON-001"), **closed)

    def _large_deposit(self):
        if "large_deposit" not in self.subjects:
            return []
        notes = "Deposit came from the investor's own exchange account and matches the declared savings."
        return [self._large(self.subjects["large_deposit"], self.labelled["large_deposit"], notes)]

    def _sof_deposit(self):
        if "sof_deposit" not in self.subjects:
            return []
        person, transfer = self.subjects["sof_deposit"], self.labelled["sof_deposit"]
        notes = "Trust distribution statement received; the deposit matches the distribution."
        data = {
            "amount": float(transfer.market_value),
            "threshold": 10000.0,
            "has_sof_documentation": False,
            "customer_age_days": 30,
            "reason": "High-value transaction by new customer without SOF documentation",
            "action_required": "Request source of funds documentation",
        }
        closed = self._closed(self._monitored(transfer), "legitimate_activity", notes, low=4320, high=7200)
        return [
            AlertPlan(person=person, data=data, transfer=transfer.tx_hash, **self._rule("MON-006"), **closed),
            self._large(person, transfer, notes),
        ]

    def _screened_send(self):
        if "screened_send" not in self.subjects:
            return []
        person, transfer = self.subjects["screened_send"], self.labelled["screened_send"]
        created = self._monitored(transfer)
        notes = (
            "Screening could not run. The destination is the investor's own exchange deposit address, "
            "confirmed against the exchange statement."
        )
        data = {
            "flagged_address": transfer.counterparty,
            "screening_id": Ref("screening", transfer.tx_hash),
            "screening_trigger": "large_transaction",
            "reason": "Crypto screening failed - address safety unverified",
            "error": SCREENING_FAILURE,
        }
        closed = self._closed(created, "false_positive", notes)
        return [
            AlertPlan(person=person, data=data, transfer=transfer.tx_hash, screened=True, **self._rule(code), **closed)
            for code in ("MON-004", "MON-005")
        ]

    def _high_volume(self):
        if "high_volume" not in self.subjects:
            return []
        transfers = self.recorded["high_volume"]
        last = self.labelled["volume-7"]
        window = [item for item in transfers if timedelta(0) <= last.at - item.at <= timedelta(days=30)]
        total = sum(item.market_value for item in window)
        created = self._batched(last)
        data = {
            "total_volume": float(total),
            "threshold": 50000.0,
            "period_days": 30,
            "reason": f"High aggregate volume: ${float(total):,.2f} in 30 days",
        }
        return [
            AlertPlan(
                person=self.subjects["high_volume"],
                data=data,
                created_at=created,
                status="reviewing",
                assignee="admin",
                assigned_at=self.story.after(created, 120, 900),
                **self._rule("MON-007"),
            )
        ]

    def _structuring(self):
        if "structuring" not in self.subjects:
            return []
        story = self.story
        created = self._batched(self.labelled["structuring-2"])
        escalated = story.after(created, 600, 1440)
        data = {
            "transaction_count": 3,
            "min_required": 3,
            "amount_range": "$8,000 - $9,999",
            "period_hours": 168,
            "pattern": "potential_structuring",
        }
        return [
            AlertPlan(
                person=self.subjects["structuring"],
                data=data,
                created_at=created,
                status="closed",
                assignee="compliance",
                assigned_at=story.after(created, 30, 180),
                resolver="compliance",
                resolved_at=story.after(escalated, 2880, 4000),
                outcome="smr_filed",
                notes="Three deposits just under AUD 10,000 in four days with no explanation. SMR lodged.",
                smr_type="ml",
                smr_reference="SMR-DEMO-0001",
                smr_filed_at=story.after(escalated, 1440, 2800),
                account_action="enhanced_monitoring",
                account_action_at=escalated,
                **self._rule("MON-003"),
            )
        ]

    def _dormant(self):
        if "dormant" not in self.subjects:
            return []
        transfer = self.labelled["dormant"]
        earlier = [item for item in self.recorded["dormant"] if item.at < transfer.at]
        previous = max(earlier, key=lambda item: item.at)
        days = (transfer.at - previous.at).days
        amount = float(transfer.market_value)
        data = {
            "days_inactive": days,
            "dormant_threshold": 90,
            "transaction_amount": amount,
            "min_amount": 5000.0,
            "last_activity": previous.at.isoformat(),
            "reason": f"Dormant account reactivation after {days} days with ${amount:,.2f} transaction",
        }
        return [
            AlertPlan(
                person=self.subjects["dormant"],
                data=data,
                created_at=self._monitored(transfer),
                status="new",
                transfer=transfer.tx_hash,
                **self._rule("MON-008"),
            )
        ]

    def _rapid(self):
        if "rapid" not in self.subjects:
            return []
        notes = "Investor was moving funds between their own wallets after setting up a new one."
        data = {
            "transaction_count": 5,
            "threshold": 5,
            "period_minutes": 60,
            "reason": "5 transactions in 60 minutes",
        }
        closed = self._closed(self._batched(self.labelled["rapid-4"]), "false_positive", notes)
        return [AlertPlan(person=self.subjects["rapid"], data=data, **self._rule("MON-002"), **closed)]

    def _manual(self, role, alert_type, severity, description, **fields):
        return AlertPlan(
            person=self.subjects[role],
            rule=MANUAL,
            alert_type=alert_type,
            severity=severity,
            description=description,
            data={},
            **fields,
        )

    def _media(self):
        if "media" not in self.subjects:
            return []
        created = self.story.moment(61, 9, 16)
        notes = "Article concerns a local planning dispute; no financial crime alleged. No action."
        description = "Regional newspaper names the customer in a planning dispute with the local council."
        closed = self._closed(created, "legitimate_activity", notes, assignee="admin")
        return [self._manual("media", "adverse_media_minor", "low", description, **closed)]

    def _discrepancy(self):
        if "discrepancy" not in self.subjects:
            return []
        created = self.story.moment(6, 9, 16)
        description = "Residential address on the profile differs from the address on the verified identity document."
        return [
            self._manual(
                "discrepancy",
                "info_discrepancy",
                "medium",
                description,
                created_at=created,
                status="reviewing",
                assignee="compliance",
                assigned_at=self.story.after(created, 60, 400),
            )
        ]

    def _terminated(self):
        if "terminated" not in self.subjects:
            return []
        changed = self.changes["terminated"]
        created = self.story.moment(75, 9, 16)
        description = "Source-of-funds documents requested three times since the first large deposit; no response."
        return [
            self._manual(
                "terminated",
                "failed_documentation",
                "medium",
                description,
                created_at=created,
                status="closed",
                assignee="compliance",
                assigned_at=self.story.after(created, 60, 300),
                resolver="compliance",
                resolved_at=changed,
                outcome="account_terminated",
                notes="No documents after three requests and a final notice. Relationship ended.",
                account_action="terminated",
                account_action_at=changed,
            )
        ]

    def _suspended(self):
        if "suspended" not in self.subjects:
            return []
        changed = self.changes["suspended"]
        created = changed - timedelta(minutes=self.story.rng.randint(40, 90))
        description = (
            "Possible match on the DFAT consolidated list (name and year of birth). "
            "Identity documents requested to rule it out."
        )
        return [
            self._manual(
                "suspended",
                "sanctions_match",
                "critical",
                description,
                created_at=created,
                status="escalated",
                assignee="compliance",
                assigned_at=self.story.after(created, 5, 20),
                notes="Escalated to the director. Account suspended while the match is resolved.",
                account_action="suspended",
                account_action_at=changed,
            )
        ]
