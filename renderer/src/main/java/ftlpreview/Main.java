package ftlpreview;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Long-lived Renderer process (ADR 0001). Listens on a local port and answers
 * {@code POST /render} with the rendered HTML, or a located error as JSON.
 * Prints {@code LISTENING <port>} on stdout once ready.
 */
public final class Main {
    private static final ObjectMapper JSON = new ObjectMapper();

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 0;
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        Renderer renderer = new Renderer();
        server.createContext("/render", exchange -> handle(exchange, renderer));
        server.start();
        System.out.println("LISTENING " + server.getAddress().getPort());
        System.out.flush();
        exitWhenParentGoes();
    }

    /** The CLI holds our stdin open; when it closes (CLI exited or crashed), stop too. */
    private static void exitWhenParentGoes() {
        Thread watcher = new Thread(() -> {
            try {
                while (System.in.read() != -1) {
                    // ignore input
                }
            } catch (IOException ignored) {
                // treat as closed
            }
            System.exit(0);
        }, "parent-watcher");
        watcher.setDaemon(true);
        watcher.start();
    }

    private static void handle(HttpExchange exchange, Renderer renderer) {
        try {
            if (!"POST".equals(exchange.getRequestMethod())) {
                send(exchange, 405, "text/plain", "POST only");
                return;
            }
            RenderRequest request = JSON.readValue(exchange.getRequestBody(), RenderRequest.class);
            try {
                send(exchange, 200, "application/json", JSON.writeValueAsString(renderer.render(request)));
            } catch (RenderException e) {
                send(exchange, 422, "application/json", JSON.writeValueAsString(Map.of("error", e.toJson())));
            }
        } catch (Exception e) {
            // Unexpected failure (bad request, unreadable theme files): still answer, so the CLI can report it
            e.printStackTrace();
            try {
                send(exchange, 500, "text/plain; charset=utf-8", String.valueOf(e));
            } catch (IOException ignored) {
                // response already started; nothing more to do
            }
        } finally {
            // Closed only now, so the error response above can still be sent
            exchange.close();
        }
    }

    private static void send(HttpExchange exchange, int status, String contentType, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
