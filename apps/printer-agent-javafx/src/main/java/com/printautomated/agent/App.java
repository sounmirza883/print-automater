package com.printautomated.agent;

import com.printautomated.agent.config.AgentConfig;
import com.printautomated.agent.config.AgentPaths;
import com.printautomated.agent.ui.MainController;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.stage.Stage;

import java.io.IOException;

public class App extends Application {
    private MainController controller;

    @Override
    public void start(Stage stage) {
        AgentPaths paths = AgentPaths.defaultPaths();
        try {
            paths.ensureDirs();
        } catch (IOException e) {
            System.err.println("Warning: could not ensure agent dirs: " + e.getMessage());
        }

        AgentConfig config = AgentConfig.load(paths.getConfigFile());

        stage.setTitle("Print Automated — Windows Agent");
        stage.setMinWidth(860);
        stage.setMinHeight(560);

        controller = new MainController(stage, paths, config);

        Scene scene = new Scene(controller.getRoot());
        scene.getStylesheets().add(getClass().getResource("/com/printautomated/agent/styles/main.css").toExternalForm());

        stage.setScene(scene);
        stage.show();

        Platform.setImplicitExit(false);
    }

    @Override
    public void stop() {
        if (controller != null) {
            controller.cleanup();
        }
    }
}
