from tokens.querysets.register_award import RegisterAwardQuerySet


class RegisterAllotmentQuerySet(RegisterAwardQuerySet):
    def register_readable_by(self, actor):
        return self.readable_by(actor)
