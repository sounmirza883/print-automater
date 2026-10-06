package com.printautomated.agent;

import com.printautomated.agent.backend.Session;
import com.printautomated.agent.models.StaffSession;
import com.printautomated.agent.models.StaffUser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

public class AuthClientTest {

    @Test
    void testJwtExpiryParsing() {
        long exp = Instant.now().plusSeconds(3600).getEpochSecond();
        String header = Base64.getUrlEncoder().withoutPadding().encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(("{\"sub\":\"user-1\",\"exp\":" + exp + "}").getBytes(StandardCharsets.UTF_8));
        String jwt = header + "." + payload + ".signature";

        Instant parsed = Session.parseJwtExpiry(jwt);
        assertNotNull(parsed);
        assertEquals(exp, parsed.getEpochSecond());
    }

    @Test
    void testSessionPersistence(@TempDir Path tempDir) {
        Path sessionFile = tempDir.resolve("session.dat");
        Session session = new Session(sessionFile);

        assertFalse(session.hasValidSession());

        StaffUser user = new StaffUser("usr-1", "test@example.com", "Tester", "OPERATOR");
        StaffSession s = new StaffSession("access-token-123", "refresh-token-456", user);
        session.set(s);

        assertTrue(session.getCurrent() != null);
        assertEquals("usr-1", session.getCurrent().getUser().getId());

        // Reload from disk into a fresh Session instance
        Session session2 = new Session(sessionFile);
        boolean loaded = session2.loadPersisted();
        assertTrue(loaded);
        assertNotNull(session2.getCurrent());
        assertEquals("refresh-token-456", session2.getCurrent().getRefreshToken());
        assertEquals("usr-1", session2.getCurrent().getUser().getId());

        // Clear session
        session2.clear();
        assertNull(session2.getCurrent());
        assertFalse(session2.loadPersisted());
    }
}
