package com.printautomated.agent.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class StaffSession {
    @JsonProperty("accessToken")
    private String accessToken = "";

    @JsonProperty("refreshToken")
    private String refreshToken = "";

    @JsonProperty("user")
    private StaffUser user = new StaffUser();

    public StaffSession() {}

    public StaffSession(String accessToken, String refreshToken, StaffUser user) {
        this.accessToken = accessToken != null ? accessToken : "";
        this.refreshToken = refreshToken != null ? refreshToken : "";
        this.user = user != null ? user : new StaffUser();
    }

    public String getAccessToken() { return accessToken; }
    public String getRefreshToken() { return refreshToken; }
    public StaffUser getUser() { return user; }

    public void setAccessToken(String accessToken) { this.accessToken = accessToken; }
    public void setRefreshToken(String refreshToken) { this.refreshToken = refreshToken; }
    public void setUser(StaffUser user) { this.user = user; }
}
