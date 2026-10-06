package com.printautomated.agent.ui;

import com.printautomated.agent.backend.OrdersClient;
import com.printautomated.agent.backend.Session;
import com.printautomated.agent.models.OrderSummary;
import com.printautomated.agent.models.OrdersPage;
import javafx.application.Platform;
import javafx.beans.property.SimpleStringProperty;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.collections.transformation.FilteredList;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;

public class OrdersViewController {
    private final OrdersClient ordersClient;
    private final Session session;
    private final Runnable onRequireSignIn;

    private VBox view;
    private TableView<OrderSummary> table;
    private ObservableList<OrderSummary> masterData = FXCollections.observableArrayList();
    private FilteredList<OrderSummary> filteredData = new FilteredList<>(masterData, p -> true);

    private Label summaryLabel;
    private Label statusMessage;
    private Button refreshButton;
    private TextField searchField;
    private ProgressIndicator progressIndicator;

    public OrdersViewController(OrdersClient ordersClient, Session session, Runnable onRequireSignIn) {
        this.ordersClient = ordersClient;
        this.session = session;
        this.onRequireSignIn = onRequireSignIn;
        initUI();
    }

    private void initUI() {
        view = new VBox(16);
        view.setPadding(new Insets(20));
        view.getStyleClass().add("content-area");

        // Top Toolbar
        HBox toolbar = new HBox(12);
        toolbar.setAlignment(Pos.CENTER_LEFT);

        VBox titleBox = new VBox(2);
        Label title = new Label("Orders and Queue");
        title.getStyleClass().add("card-title");
        title.setStyle("-fx-font-size: 18px;");

        summaryLabel = new Label("Loading orders...");
        summaryLabel.getStyleClass().add("card-subtitle");
        titleBox.getChildren().addAll(title, summaryLabel);

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        searchField = new TextField();
        searchField.setPromptText("Search order or customer...");
        searchField.setPrefWidth(220);
        searchField.textProperty().addListener((obs, oldVal, newVal) -> {
            filteredData.setPredicate(order -> {
                if (newVal == null || newVal.isBlank()) return true;
                String lower = newVal.toLowerCase();
                return order.getOrderNumber().toLowerCase().contains(lower)
                        || order.getCustomerName().toLowerCase().contains(lower)
                        || order.getOrderStatus().toLowerCase().contains(lower);
            });
        });

        progressIndicator = new ProgressIndicator();
        progressIndicator.setPrefSize(18, 18);
        progressIndicator.setVisible(false);

        refreshButton = new Button("Refresh");
        refreshButton.getStyleClass().add("btn-secondary");
        refreshButton.setOnAction(e -> loadOrders());

        toolbar.getChildren().addAll(titleBox, spacer, progressIndicator, searchField, refreshButton);

        // Status / Error message
        statusMessage = new Label();
        statusMessage.getStyleClass().addAll("status-pill", "pill-warning");
        statusMessage.setVisible(false);
        statusMessage.setManaged(false);

        // Orders Table
        table = new TableView<>();
        table.setItems(filteredData);
        VBox.setVgrow(table, Priority.ALWAYS);

        // Columns
        TableColumn<OrderSummary, String> colOrder = new TableColumn<>("Order");
        colOrder.setPrefWidth(120);
        colOrder.setCellValueFactory(c -> new SimpleStringProperty(c.getValue().getOrderNumber()));
        colOrder.setCellFactory(col -> new TableCell<>() {
            @Override
            protected void updateItem(String item, boolean empty) {
                super.updateItem(item, empty);
                if (empty || item == null) {
                    setText(null);
                } else {
                    setText(item);
                    setStyle("-fx-font-family: 'Cascadia Code', Consolas, monospace; -fx-font-weight: bold; -fx-text-fill: #58a6ff;");
                }
            }
        });

        TableColumn<OrderSummary, String> colStatus = new TableColumn<>("Status");
        colStatus.setPrefWidth(150);
        colStatus.setCellValueFactory(c -> new SimpleStringProperty(c.getValue().getOrderStatus()));
        colStatus.setCellFactory(col -> new TableCell<>() {
            @Override
            protected void updateItem(String item, boolean empty) {
                super.updateItem(item, empty);
                if (empty || item == null) {
                    setGraphic(null);
                    setText(null);
                } else {
                    Label badge = new Label(item);
                    badge.getStyleClass().add("status-pill");
                    String s = item.toLowerCase();
                    if (s.contains("completed") || s.contains("printed")) {
                        badge.getStyleClass().add("pill-success");
                    } else if (s.contains("production") || s.contains("printing")) {
                        badge.getStyleClass().add("pill-info");
                    } else if (s.contains("pending") || s.contains("ready")) {
                        badge.getStyleClass().add("pill-warning");
                    } else if (s.contains("cancelled") || s.contains("failed")) {
                        badge.getStyleClass().add("pill-danger");
                    } else {
                        badge.getStyleClass().add("pill-neutral");
                    }
                    setGraphic(badge);
                    setText(null);
                }
            }
        });

        TableColumn<OrderSummary, String> colPayment = new TableColumn<>("Payment");
        colPayment.setPrefWidth(120);
        colPayment.setCellValueFactory(c -> new SimpleStringProperty(c.getValue().getPaymentStatus()));
        colPayment.setCellFactory(col -> new TableCell<>() {
            @Override
            protected void updateItem(String item, boolean empty) {
                super.updateItem(item, empty);
                if (empty || item == null) {
                    setGraphic(null);
                    setText(null);
                } else {
                    Label badge = new Label(item);
                    badge.getStyleClass().add("status-pill");
                    if (item.equalsIgnoreCase("Paid")) {
                        badge.getStyleClass().add("pill-success");
                    } else if (item.toLowerCase().contains("pending")) {
                        badge.getStyleClass().add("pill-warning");
                    } else {
                        badge.getStyleClass().add("pill-neutral");
                    }
                    setGraphic(badge);
                    setText(null);
                }
            }
        });

        TableColumn<OrderSummary, String> colCustomer = new TableColumn<>("Customer");
        colCustomer.setPrefWidth(160);
        colCustomer.setCellValueFactory(c -> new SimpleStringProperty(c.getValue().getCustomerName()));

        TableColumn<OrderSummary, String> colTotal = new TableColumn<>("Total");
        colTotal.setPrefWidth(110);
        colTotal.setCellValueFactory(c -> new SimpleStringProperty(c.getValue().getTotalFormatted()));
        colTotal.setStyle("-fx-alignment: CENTER_RIGHT; -fx-font-weight: bold;");

        TableColumn<OrderSummary, String> colCreated = new TableColumn<>("Created");
        colCreated.setPrefWidth(150);
        colCreated.setCellValueFactory(c -> new SimpleStringProperty(c.getValue().getCreatedAt()));

        TableColumn<OrderSummary, String> colDoc = new TableColumn<>("Document");
        colDoc.setPrefWidth(180);
        colDoc.setCellValueFactory(c -> new SimpleStringProperty(c.getValue().getDocumentTitle()));

        table.getColumns().addAll(colOrder, colStatus, colPayment, colCustomer, colTotal, colCreated, colDoc);
        table.setPlaceholder(new Label("No orders found. Orders appear here as customers place them."));

        view.getChildren().addAll(toolbar, statusMessage, table);
    }

    public void loadOrders() {
        if (!session.hasValidSession()) {
            summaryLabel.setText("Sign in with staff credentials to view orders.");
            statusMessage.setText("Staff sign-in required to view orders and queue.");
            statusMessage.setVisible(true);
            statusMessage.setManaged(true);
            masterData.clear();
            if (onRequireSignIn != null) onRequireSignIn.run();
            return;
        }

        progressIndicator.setVisible(true);
        refreshButton.setDisable(true);
        statusMessage.setVisible(false);
        statusMessage.setManaged(false);

        new Thread(() -> {
            try {
                OrdersPage page = ordersClient.fetchOrders(50, 0);
                Platform.runLater(() -> {
                    masterData.setAll(page.getItems());
                    if (page.getItems().isEmpty()) {
                        summaryLabel.setText("No orders yet. Orders appear here as customers place them.");
                    } else if (page.getItems().size() < page.getTotal()) {
                        summaryLabel.setText(String.format("Showing newest %d of %d orders.", page.getItems().size(), page.getTotal()));
                    } else {
                        summaryLabel.setText(String.format("%d %s.", page.getItems().size(), page.getItems().size() == 1 ? "order" : "orders"));
                    }
                    progressIndicator.setVisible(false);
                    refreshButton.setDisable(false);
                });
            } catch (Exception e) {
                Platform.runLater(() -> {
                    statusMessage.setText("Could not load orders: " + e.getMessage());
                    statusMessage.setVisible(true);
                    statusMessage.setManaged(true);
                    summaryLabel.setText("Failed to load orders.");
                    progressIndicator.setVisible(false);
                    refreshButton.setDisable(false);
                });
            }
        }).start();
    }

    public VBox getView() { return view; }
}
