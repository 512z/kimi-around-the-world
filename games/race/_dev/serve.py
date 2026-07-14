# Static server with caching disabled — module edits show up on plain reload.
# Usage: python3 _dev/serve.py [port]
import http.server, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8140
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('', PORT), H).serve_forever()
