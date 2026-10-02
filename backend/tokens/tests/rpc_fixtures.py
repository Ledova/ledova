import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UNKNOWN_METHOD = {"error": {"code": -32601, "message": "the method does not exist"}}


class ScriptedNode:
    def __init__(self, answers):
        self.answers = dict(answers)
        self.methods = []
        node = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                node.methods.append(request["method"])
                answer = node.answers.get(request["method"], UNKNOWN_METHOD)
                if isinstance(answer, list):
                    answer = answer.pop(0) if len(answer) > 1 else answer[0]
                body = json.dumps({"jsonrpc": "2.0", "id": request["id"], **answer}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *arguments):
                return None

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exception):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
