import unittest

from helix_compute import TARGETS, route_compute


class RouteTests(unittest.TestCase):
    def test_weather_cloud(self):
        r = route_compute("Check the weather", override="AUTO")
        self.assertEqual(r["suggested"], "CLOUD-AI")

    def test_docker_logs_bigboi(self):
        r = route_compute("Check bigboi Docker logs", override="AUTO")
        self.assertEqual(r["suggested"], "BIGBOI")

    def test_analyse_logs_bigboi(self):
        r = route_compute("Analyse 5GB of logs", override="AUTO")
        self.assertEqual(r["suggested"], "BIGBOI")

    def test_summarise_ollama(self):
        r = route_compute("Summarise these logs", override="AUTO")
        self.assertEqual(r["suggested"], "OLLAMA-LOCAL")

    def test_architecture_cloud(self):
        r = route_compute("Diagnose this complicated software architecture", override="AUTO")
        self.assertEqual(r["suggested"], "CLOUD-AI")

    def test_restart_helix_mac(self):
        r = route_compute("Restart Helix", override="AUTO")
        self.assertEqual(r["suggested"], "LOCAL-MAC")

    def test_index_docs_bigboi(self):
        r = route_compute("Index my document library", override="AUTO")
        self.assertEqual(r["suggested"], "BIGBOI")

    def test_embeddings_ollama(self):
        r = route_compute("Generate embeddings", override="AUTO")
        self.assertEqual(r["suggested"], "OLLAMA-LOCAL")

    def test_docker_containers_bigboi(self):
        r = route_compute("Check all Docker containers", override="AUTO")
        self.assertEqual(r["suggested"], "BIGBOI")

    def test_update_hermes_mac(self):
        r = route_compute("Update Hermes configuration", override="AUTO")
        self.assertEqual(r["suggested"], "LOCAL-MAC")

    def test_manual_override(self):
        r = route_compute("Check all Docker containers", override="LOCAL-MAC")
        self.assertEqual(r["suggested"], "BIGBOI")
        self.assertEqual(r["target"], "LOCAL-MAC")
        self.assertFalse(r["auto"])

    def test_targets(self):
        self.assertIn("BIGBOI", TARGETS)
        self.assertIn("OLLAMA-LOCAL", TARGETS)


if __name__ == "__main__":
    unittest.main()
