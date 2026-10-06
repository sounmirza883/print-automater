package com.printautomated.agent.ui;

import com.printautomated.agent.backend.AgentStatusClient;
import com.printautomated.agent.backend.ApiClient;
import com.printautomated.agent.backend.AuthClient;
import com.printautomated.agent.backend.OrdersClient;
import com.printautomated.agent.backend.Session;
import com.printautomated.agent.config.AgentConfig;
import com.printautomated.agent.config.AgentPaths;
import com.printautomated.agent.models.AgentStatus;
import com.printautomated.agent.models.StaffSession;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.layout.*;
import javafx.stage.Stage;

import java.util.Timer;
import java.util.TimerTask;

public class MainController {
    private final Stage stage;
    private final AgentPaths paths;
    private final AgentConfig config;
    private final AuthClient authClient;
    private final Session session;
    private final ApiClient apiClient;
    private final OrdersClient ordersClient;
    private final AgentStatusClient statusClient;

    private BorderPane root;
    private Label connectionPill;
    private Button authButton;

    private Button btnTabStatus;
    private Button btnTabOrders;
    private Button btnTabPrinters;

    private StatusViewController statusViewController;
    private OrdersViewController ordersViewController;
    private PrintersViewController printersViewController;

    private TrayManager trayManager;
    private Timer pollTimer;

    public MainController(Stage stage, AgentPaths paths, AgentConfig config) {
        this.stage = stage;
        this.paths = paths;
        this.config = config;

        this.authClient = new AuthClient(config.getApiBaseUrl());
        this.session = new Session(paths.getSessionFile());
        this.apiClient = new ApiClient(config.getApiBaseUrl(), session, authClient);
        this.ordersClient = new OrdersClient(apiClient);
        this.statusClient = new AgentStatusClient();

        // Restore persisted session if available
        if (session.loadPersisted()) {
            new Thread(() -> {
                try {
                    StaffSession refreshed = authClient.refresh(
                            session.getCurrent().getRefreshToken(),
                            session.getCurrent().getAccessToken());
                    session.set(refreshed);
                    Platform.runLater(this::updateAuthButton);
                } catch (Exception e) {
                    session.clear();
                    Platform.runLater(this::updateAuthButton);
                }
            }).start();
        }

        initUI();
        initPolling();

        this.trayManager = new TrayManager(stage, this::showOrdersTab);

        // Show login if no session present (slice 1 behavior)
        if (!session.hasValidSession()) {
            Platform.runLater(this::promptLogin);
        }
    }

    private void initUI() {
        root = new BorderPane();
        root.setPrefSize(1020, 680);

        // Top Header
        VBox topContainer = new VBox();

        HBox header = new HBox(16);
        header.getStyleClass().add("app-header");
        header.setAlignment(Pos.CENTER_LEFT);

        VBox brandBox = new VBox(2);
        Label title = new Label("Print Automated");
        title.getStyleClass().add("brand-title");
        Label subtitle = new Label("Windows Native Agent & Shop Operations");
        subtitle.getStyleClass().add("brand-subtitle");
        brandBox.getChildren().addAll(title, subtitle);

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        connectionPill = new Label("CONNECTING");
        connectionPill.getStyleClass().addAll("status-pill", "pill-warning");

        Button refreshBtn = new Button("↻ Refresh");
        refreshBtn.getStyleClass().add("btn-secondary");
        refreshBtn.setOnAction(e -> refreshAll());

        authButton = new Button("Staff Sign In");
        authButton.getStyleClass().add("btn-secondary");
        authButton.setOnAction(e -> handleAuthButtonClick());
        updateAuthButton();

        header.getChildren().addAll(brandBox, spacer, connectionPill, refreshBtn, authButton);

        // Nav Bar
        HBox navBar = new HBox(8);
        navBar.getStyleClass().add("nav-bar");

        btnTabStatus = createNavButton("Overview & Pairing", true);
        btnTabStatus.setOnAction(e -> showStatusTab());

        btnTabOrders = createNavButton("Orders & Queue", false);
        btnTabOrders.setOnAction(e -> showOrdersTab());

        btnTabPrinters = createNavButton("Connected Printers", false);
        btnTabPrinters.setOnAction(e -> showPrintersTab());

        navBar.getChildren().addAll(btnTabStatus, btnTabOrders, btnTabPrinters);
        topContainer.getChildren().addAll(header, navBar);
        root.setTop(topContainer);

        // Sub-views
        statusViewController = new StatusViewController(statusClient, s -> showOrdersTab());
        ordersViewController = new OrdersViewController(ordersClient, session, this::promptLogin);
        printersViewController = new PrintersViewController();

        showStatusTab();
    }

    private Button createNavButton(String text, boolean active) {
        Button b = new Button(text);
        b.getStyleClass().add("nav-button");
        if (active) b.getStyleClass().add("nav-button-active");
        return b;
    }

    private void setActiveNav(Button activeBtn) {
        btnTabStatus.getStyleClass().remove("nav-button-active");
        btnTabOrders.getStyleClass().remove("nav-button-active");
        btnTabPrinters.getStyleClass().remove("nav-button-active");
        activeBtn.getStyleClass().add("nav-button-active");
    }

    public void showStatusTab() {
        setActiveNav(btnTabStatus);
        root.setCenter(statusViewController.getView());
        pollStatusNow();
    }

    public void showOrdersTab() {
        setActiveNav(btnTabOrders);
        root.setCenter(ordersViewController.getView());
        ordersViewController.loadOrders();
    }

    public void showPrintersTab() {
        setActiveNav(btnTabPrinters);
        root.setCenter(printersViewController.getView());
        printersViewController.reloadPrinters();
    }

    private void refreshAll() {
        pollStatusNow();
        if (root.getCenter() == ordersViewController.getView()) {
            ordersViewController.loadOrders();
        } else if (root.getCenter() == printersViewController.getView()) {
            printersViewController.reloadPrinters();
        }
    }

    private void initPolling() {
        pollTimer = new Timer("StatusPollTimer", true);
        pollTimer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                pollStatusNow();
            }
        }, 1000, 10000);
    }

    private void pollStatusNow() {
        new Thread(() -> {
            AgentStatus s = statusClient.fetchStatus();
            Platform.runLater(() -> {
                statusViewController.updateStatus(s);
                if (s.isPaired()) {
                    connectionPill.setText("CONNECTED");
                    connectionPill.getStyleClass().setAll("status-pill", "pill-success");
                } else if (s.isPairing()) {
                    connectionPill.setText("PAIRING");
                    connectionPill.getStyleClass().setAll("status-pill", "pill-warning");
                } else {
                    connectionPill.setText("NOT PAIRED");
                    connectionPill.getStyleClass().setAll("status-pill", "pill-warning");
                }
            });
        }).start();
    }

    private void handleAuthButtonClick() {
        if (session.hasValidSession()) {
            // Sign Out
            session.clear();
            updateAuthButton();
            if (root.getCenter() == ordersViewController.getView()) {
                ordersViewController.loadOrders();
            }
        } else {
            promptLogin();
        }
    }

    private void promptLogin() {
        LoginDialog dialog = new LoginDialog(stage, authClient, session, s -> {
            updateAuthButton();
            if (root.getCenter() == ordersViewController.getView()) {
                ordersViewController.loadOrders();
            }
        });
        dialog.show();
    }

    private void updateAuthButton() {
        if (session.hasValidSession() && session.getCurrent().getUser() != null) {
            String name = session.getCurrent().getUser().getFullName();
            if (name == null || name.isBlank()) name = session.getCurrent().getUser().getEmail();
            authButton.setText(name + " (Sign Out)");
            authButton.getStyleClass().remove("btn-secondary");
            authButton.getStyleClass().add("btn-secondary");
        } else {
            authButton.setText("Staff Sign In");
            authButton.getStyleClass().remove("btn-primary");
            authButton.getStyleClass().add("btn-secondary");
        }
    }

    public void cleanup() {
        if (pollTimer != null) pollTimer.cancel();
        if (trayManager != null) trayManager.remove();
    }

    public BorderPane getRoot() { return root; }
}
