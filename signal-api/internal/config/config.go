package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port      string
	DBURL     string
	JWTSecret string
	WebOrigin string
}

func Load() (Config, error) {
	cfg := Config{
		Port:      os.Getenv("PORT"),
		DBURL:     os.Getenv("DB_URL"),
		JWTSecret: os.Getenv("JWT_SECRET"),
		WebOrigin: os.Getenv("WEB_ORIGIN"),
	}

	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.WebOrigin == "" {
		cfg.WebOrigin = "http://localhost:5173"
	}
	if cfg.DBURL == "" {
		return Config{}, fmt.Errorf("DB_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}

	return cfg, nil
}
