import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

import ai_service
_test_storage = tempfile.TemporaryDirectory()
os.environ["DATABASE_PATH"] = str(Path(_test_storage.name) / "bootstrap.sqlite3")
os.environ["UPLOAD_FOLDER"] = str(Path(_test_storage.name) / "uploads")
os.environ["SECRET_KEY"] = "test-only-secret-key"
os.environ["DATABASE_URL"] = ""

from app import (
    PostgresConnection,
    app,
    calculate_statistic,
    clean_export_text,
    get_db,
    init_db,
    sanitize_rich_html,
)  # noqa: E402


def tearDownModule():
    _test_storage.cleanup()


class ResearchOsApiTests(unittest.TestCase):
    def setUp(self):
        self.storage = tempfile.TemporaryDirectory()
        app.config.update(
            TESTING=True,
            DATABASE_URL="",
            DATABASE_PATH=str(Path(self.storage.name) / "test.sqlite3"),
            UPLOAD_FOLDER=str(Path(self.storage.name) / "uploads"),
            SECRET_KEY="test-only-secret-key",
        )
        with app.app_context():
            init_db()
        self.client = app.test_client()

    def tearDown(self):
        self.storage.cleanup()

    def register(self, email="researcher@example.org"):
        response = self.client.post(
            "/api/auth/register",
            json={"name": "Researcher", "email": email, "password": "secure-test-password"},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        payload = response.get_json()
        self.csrf = payload["csrf_token"]
        return payload["user"]

    def write_headers(self):
        return {"X-CSRF-Token": self.csrf}

    def create_project(self, title="Research project"):
        response = self.client.post(
            "/api/projects",
            json={"title": title, "field": "Education", "research_type": "Qualitative"},
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()["project"]

    def test_authentication_and_project_creation_initialize_document(self):
        user = self.register()
        project = self.create_project()
        self.assertEqual(project["user_id"], user["id"])
        documents = self.client.get(f"/api/projects/{project['id']}/documents").get_json()["documents"]
        self.assertEqual(len(documents), 1)
        self.assertEqual([section["title"] for section in documents[0]["content"]["sections"]],
                         [f"Chapter {number}" for number in range(1, 6)])

    def test_multiple_projects_are_kept_separate(self):
        self.register()
        first = self.create_project("First research project")
        second = self.create_project("Second research project")
        response = self.client.get("/api/projects")
        projects = response.get_json()["projects"]
        self.assertEqual({project["id"] for project in projects}, {first["id"], second["id"]})
        first_document = self.client.get(f"/api/projects/{first['id']}/documents").get_json()["documents"][0]
        second_document = self.client.get(f"/api/projects/{second['id']}/documents").get_json()["documents"][0]
        self.assertNotEqual(first_document["id"], second_document["id"])

    def test_manuscript_can_be_deleted_with_its_project_data(self):
        self.register()
        project = self.create_project()
        document = self.client.get(f"/api/projects/{project['id']}/documents").get_json()["documents"][0]
        deleted = self.client.delete(
            f"/api/projects/{project['id']}",
            headers=self.write_headers(),
        )
        self.assertEqual(deleted.status_code, 200, deleted.get_json())
        self.assertEqual(self.client.get(f"/api/projects/{project['id']}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/documents/{document['id']}/versions").status_code, 404)
        self.assertEqual(self.client.get("/api/projects").get_json()["projects"], [])

    def test_project_can_be_updated_and_update_is_private(self):
        self.register()
        project = self.create_project()
        response = self.client.patch(
            f"/api/projects/{project['id']}",
            headers=self.write_headers(),
            json={
                "title": "Updated research project",
                "field": "Public health",
                "research_type": "Quantitative",
                "institution": "Example University",
                "status": "In progress",
            },
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["project"]["project_title"], "Updated research project")
        self.assertEqual(response.get_json()["project"]["research_status"], "In progress")

        self.client.post("/api/auth/logout", json={}, headers=self.write_headers())
        self.register("another@example.org")
        denied = self.client.patch(
            f"/api/projects/{project['id']}",
            headers=self.write_headers(),
            json={"title": "Not yours"},
        )
        self.assertEqual(denied.status_code, 404)

    def test_project_documents_are_private_between_accounts(self):
        self.register()
        project = self.create_project()
        document = self.client.get(f"/api/projects/{project['id']}/documents").get_json()["documents"][0]
        self.client.post("/api/auth/logout", json={}, headers=self.write_headers())
        self.register("another@example.org")
        response = self.client.get(f"/api/projects/{project['id']}")
        self.assertEqual(response.status_code, 404)
        versions = self.client.get(f"/api/documents/{document['id']}/versions")
        self.assertEqual(versions.status_code, 404)
        version = self.client.get(f"/api/documents/{document['id']}/versions/1")
        self.assertEqual(version.status_code, 404)

    def test_autosave_tracks_previous_revision(self):
        self.register()
        project = self.create_project()
        document = self.client.get(f"/api/projects/{project['id']}/documents").get_json()["documents"][0]
        content = {"sections": [{"title": "Chapter 1", "content": "Updated manuscript."}]}
        response = self.client.put(
            f"/api/documents/{document['id']}/autosave",
            json={"content": content, "version": 1},
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["version"], 2)
        versions = self.client.get(f"/api/documents/{document['id']}/versions").get_json()["versions"]
        self.assertEqual([version["version_number"] for version in versions], [1])
        self.assertNotIn("content", versions[0])
        self.assertIn("created_at", versions[0])
        version = self.client.get(f"/api/documents/{document['id']}/versions/1").get_json()["version"]
        self.assertEqual(version["content"]["sections"][0]["content"], "")
        unchanged = self.client.put(
            f"/api/documents/{document['id']}/autosave",
            json={"content": content, "version": 1},
            headers=self.write_headers(),
        )
        self.assertEqual(unchanged.status_code, 200)
        self.assertTrue(unchanged.get_json()["unchanged"])
        self.assertEqual(unchanged.get_json()["version"], 2)
        stale = self.client.put(
            f"/api/documents/{document['id']}/autosave",
            json={"content": {"sections": [{"title": "Overwritten", "content": "stale"}]}, "version": 1},
            headers=self.write_headers(),
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.get_json()["error"]["code"], "document_conflict")

    def test_literature_synthesis_uses_only_saved_project_sources(self):
        self.register()
        project = self.create_project()
        saved = self.client.post(
            f"/api/projects/{project['id']}/sources",
            json={
                "title": "Learning outcomes in higher education",
                "authors": [{"firstName": "A.", "lastName": "Researcher"}],
                "publication_year": 2024,
                "abstract": "This study reports measured learning outcomes.",
            },
            headers=self.write_headers(),
        )
        self.assertEqual(saved.status_code, 201, saved.get_json())
        with patch("app.ask_json", return_value={
            "synthesis": "The saved study reports learning outcomes [S1].",
            "themes": ["Learning outcomes"],
        }) as ask_json:
            response = self.client.post(f"/api/projects/{project['id']}/literature/synthesize", json={})
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()
        self.assertEqual(result["synthesis"], "The saved study reports learning outcomes [S1].")
        self.assertEqual(result["sources"][0]["key"], "S1")
        self.assertIn("Learning outcomes in higher education", result["sources"][0]["citation"])
        self.assertEqual(ask_json.call_count, 1)
        with patch("app.ask_json", return_value={"synthesis": "Unsupported [S2].", "themes": []}):
            invalid_citation = self.client.post(
                f"/api/projects/{project['id']}/literature/synthesize", json={},
            )
        self.assertEqual(invalid_citation.status_code, 502)
        self.assertEqual(invalid_citation.get_json()["error"]["code"], "invalid_ai_citation")

    def test_framework_maker_generates_valid_project_scoped_output(self):
        self.register()
        project = self.create_project()
        generated = {
            "title": "Conceptual Framework",
            "overview": "A study-grounded model.",
            "theoretical_basis": "",
            "constructs": [{"name": "Study habits", "role": "Predictor", "description": "Time allocated to study."}],
            "relationships": [{"from": "Study habits", "to": "Academic performance", "description": "Proposed association."}],
            "diagram": "Study habits -> Academic performance",
            "manuscript_section": "This study proposes a relationship between study habits and academic performance.",
            "limitations": ["The model does not establish causality."],
        }
        with patch("app.ask_json", return_value=generated) as ask_json:
            response = self.client.post(
                f"/api/projects/{project['id']}/framework",
                json={
                    "framework_type": "conceptual",
                    "study": "A study of study habits and academic performance.",
                    "description": "Show study habits connected to performance.",
                },
            )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["constructs"][0]["name"], "Study habits")
        self.assertIn("Do not invent findings", ask_json.call_args.args[0])
        with app.app_context():
            history = get_db().execute(
                "SELECT feature_type FROM ai_generation_history WHERE user_id = ?",
                (self.client.get("/api/auth/me").get_json()["user"]["id"],),
            ).fetchone()
        self.assertEqual(history["feature_type"], "framework_maker")
        theoretical_output = {**generated, "theoretical_basis": "Candidate theory requiring researcher verification."}
        with patch("app.ask_json", return_value=theoretical_output) as theoretical_request:
            theoretical = self.client.post(
                f"/api/projects/{project['id']}/framework",
                json={"framework_type": "theoretical", "study": "A study with no named theory."},
            )
        self.assertEqual(theoretical.status_code, 200, theoretical.get_json())
        self.assertEqual(theoretical.get_json()["framework_type"], "theoretical")
        self.assertIn("candidate theory", theoretical_request.call_args.args[0])

    def test_framework_maker_rejects_invalid_input_and_malformed_ai_output(self):
        self.register()
        project = self.create_project()
        invalid = self.client.post(
            f"/api/projects/{project['id']}/framework",
            json={"framework_type": "other", "study": "A study."},
        )
        self.assertEqual(invalid.status_code, 400)
        invalid_type = self.client.post(
            f"/api/projects/{project['id']}/framework",
            json={"framework_type": [], "study": "A study."},
        )
        self.assertEqual(invalid_type.status_code, 400)
        with patch("app.ask_json", return_value={"title": "Incomplete"}):
            malformed = self.client.post(
                f"/api/projects/{project['id']}/framework",
                json={"framework_type": "theoretical", "study": "A study."},
            )
        self.assertEqual(malformed.status_code, 502)
        self.assertEqual(malformed.get_json()["error"]["code"], "invalid_ai_response")

    def test_framework_boards_can_be_saved_updated_listed_and_deleted_per_project(self):
        self.register()
        project = self.create_project()
        board = {
            "title": "Learning model",
            "framework_type": "conceptual",
            "study": "Study habits and performance.",
            "description": "Show a direct relationship.",
            "manuscript_section": "Study habits may be associated with performance.",
            "diagram": {
                "nodes": [
                    {"id": "study", "kind": "rectangle", "label": "Study habits", "body": "Predictor",
                     "x": 100, "y": 120, "width": 240, "height": 120, "fill": "#ffffff", "color": "#30242a"},
                    {"id": "outcome", "kind": "ellipse", "label": "Performance", "body": "Outcome",
                     "x": 500, "y": 120, "width": 240, "height": 120, "fill": "#fde9ee", "color": "#30242a"},
                ],
                "edges": [{
                    "id": "link", "from": "study", "to": "outcome", "label": "Proposed association",
                    "style": "dashed", "direction": "both",
                }],
            },
        }
        created = self.client.post(
            f"/api/projects/{project['id']}/frameworks",
            json=board,
            headers=self.write_headers(),
        )
        self.assertEqual(created.status_code, 201, created.get_json())
        saved = created.get_json()["board"]
        self.assertEqual(saved["diagram"]["edges"][0]["from"], "study")
        self.assertEqual(saved["diagram"]["edges"][0]["style"], "dashed")
        self.assertEqual(saved["diagram"]["edges"][0]["direction"], "both")
        self.assertEqual(saved["manuscript_section"], board["manuscript_section"])
        listed = self.client.get(f"/api/projects/{project['id']}/frameworks")
        self.assertEqual(listed.get_json()["boards"][0]["id"], saved["id"])
        board["title"] = "Updated learning model"
        board["diagram"]["nodes"][0]["label"] = "Study routine"
        board["manuscript_section"] = "Updated draft."
        updated = self.client.put(
            f"/api/frameworks/{saved['id']}",
            json=board,
            headers=self.write_headers(),
        )
        self.assertEqual(updated.status_code, 200, updated.get_json())
        self.assertEqual(updated.get_json()["board"]["title"], "Updated learning model")
        self.assertEqual(updated.get_json()["board"]["diagram"]["nodes"][0]["label"], "Study routine")
        self.assertEqual(updated.get_json()["board"]["manuscript_section"], "Updated draft.")
        board["diagram"]["edges"][0]["style"] = "zigzag"
        invalid_style = self.client.put(
            f"/api/frameworks/{saved['id']}",
            json=board,
            headers=self.write_headers(),
        )
        self.assertEqual(invalid_style.status_code, 400)
        removed = self.client.delete(f"/api/frameworks/{saved['id']}", headers=self.write_headers())
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self.client.get(f"/api/projects/{project['id']}/frameworks").get_json()["boards"], [])

    def test_framework_boards_reject_invalid_geometry_edges_and_foreign_access(self):
        self.register()
        project = self.create_project()
        invalid = {
            "title": "Invalid board",
            "framework_type": "conceptual",
            "diagram": {
                "nodes": [{"id": "one", "kind": "rectangle", "label": "One", "body": "",
                           "x": -1, "y": 0, "width": 240, "height": 120, "fill": "#ffffff", "color": "#30242a"}],
                "edges": [],
            },
        }
        response = self.client.post(
            f"/api/projects/{project['id']}/frameworks",
            json=invalid,
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 400)
        invalid["diagram"]["nodes"][0]["kind"] = []
        invalid["diagram"]["nodes"][0]["x"] = 0
        response = self.client.post(
            f"/api/projects/{project['id']}/frameworks",
            json=invalid,
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 400)
        invalid["diagram"]["nodes"][0]["x"] = 0
        invalid["diagram"]["nodes"][0]["kind"] = "rectangle"
        invalid["diagram"]["edges"] = [{"id": "bad", "from": "one", "to": "missing", "label": ""}]
        response = self.client.post(
            f"/api/projects/{project['id']}/frameworks",
            json=invalid,
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 400)

        valid = {
            "title": "Private board", "framework_type": "theoretical",
            "diagram": {
                "nodes": [{"id": "one", "kind": "text", "label": "Theory", "body": "",
                           "x": 0, "y": 0, "width": 240, "height": 100, "fill": "#ffffff", "color": "#30242a"}],
                "edges": [],
            },
        }
        saved = self.client.post(
            f"/api/projects/{project['id']}/frameworks",
            json=valid,
            headers=self.write_headers(),
        ).get_json()["board"]
        self.client.post("/api/auth/logout", json={}, headers=self.write_headers())
        self.register("another@example.org")
        self.assertEqual(self.client.get(f"/api/projects/{project['id']}/frameworks").status_code, 404)
        self.assertEqual(self.client.put(
            f"/api/frameworks/{saved['id']}", json=valid, headers=self.write_headers(),
        ).status_code, 404)

    def test_reference_import_supports_ris_and_bibtex_and_skips_duplicates(self):
        self.register()
        project = self.create_project()
        ris = (
            "TY  - JOUR\n"
            "TI  - A RIS reference\n"
            "AU  - Researcher, Alex\n"
            "PY  - 2022\n"
            "JO  - Journal of Tests\n"
            "DO  - 10.1000/ris-record\n"
            "ER  -\n"
        )
        response = self.client.post(
            f"/api/projects/{project['id']}/sources/import",
            data={"file": (io.BytesIO(ris.encode()), "references.ris")},
            headers=self.write_headers(),
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertEqual(response.get_json()["imported"], 1)
        saved = self.client.get(f"/api/projects/{project['id']}/sources").get_json()["sources"]
        self.assertEqual(saved[0]["authors"][0], {"firstName": "Alex", "lastName": "Researcher"})
        self.assertEqual(saved[0]["metadata_verified"], 0)

        duplicate = self.client.post(
            f"/api/projects/{project['id']}/sources/import",
            data={"file": (io.BytesIO(ris.encode()), "references.ris")},
            headers=self.write_headers(),
            content_type="multipart/form-data",
        )
        self.assertEqual(duplicate.status_code, 201)
        self.assertEqual(duplicate.get_json()["skipped_duplicates"], 1)

        bibtex = (
            b"@article{nested, title={A {Nested} title}, "
            b"author={Doe, Jane and Smith, John}, year={2023}, "
            b"journal={A Journal}, abstract={Text {with} braces}, "
            b"doi={10.1000/bib-record}, url={https://example.org/paper}}"
        )
        imported_bibtex = self.client.post(
            f"/api/projects/{project['id']}/sources/import",
            data={"file": (io.BytesIO(bibtex), "references.bib")},
            headers=self.write_headers(),
            content_type="multipart/form-data",
        )
        self.assertEqual(imported_bibtex.status_code, 201, imported_bibtex.get_json())
        sources = self.client.get(f"/api/projects/{project['id']}/sources").get_json()["sources"]
        source = next(item for item in sources if item["title"] == "A {Nested} title")
        self.assertEqual(source["title"], "A {Nested} title")
        self.assertEqual(source["publication_year"], 2023)
        self.assertEqual(len(source["authors"]), 2)

    def test_rich_text_autosave_sanitizes_unsafe_markup_and_exports_readably(self):
        self.register()
        project = self.create_project()
        document = self.client.get(f"/api/projects/{project['id']}/documents").get_json()["documents"][0]
        unsafe_html = '<p style="color: red; background-image: url(javascript:alert(1))"><strong>Draft</strong><script>alert(1)</script><a href="javascript:alert(1)">link</a></p>'
        response = self.client.put(
            f"/api/documents/{document['id']}/autosave",
            json={"content": {"sections": [{"title": "Chapter 1", "content": unsafe_html}]}, "version": 1},
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        saved = self.client.get(f"/api/projects/{project['id']}/documents").get_json()["documents"][0]
        saved_html = saved["content"]["sections"][0]["content"]
        self.assertNotIn("<script", saved_html)
        self.assertNotIn("javascript:", saved_html)
        self.assertIn("<strong>Draft</strong>", saved_html)
        self.assertEqual(clean_export_text("<p><strong>Draft</strong></p><p>Second paragraph</p>"),
                         "Draft\n\nSecond paragraph")
        self.assertNotIn("background-image", sanitize_rich_html(unsafe_html))

    def test_rich_text_tables_and_images_are_safe_and_export_as_readable_text(self):
        rich_html = (
            '<table><tbody><tr><th>Measure</th><th>Value</th></tr>'
            '<tr><td>Mean</td><td>4.2</td></tr></tbody></table>'
            '<img src="data:image/png;base64,AAAA" alt="Chart">'
        )
        sanitized = sanitize_rich_html(rich_html)
        self.assertIn("<table>", sanitized)
        self.assertIn('src="data:image/png;base64,AAAA"', sanitized)
        self.assertEqual(
            clean_export_text(sanitized),
            "Measure\tValue\nMean\t4.2\n[Image: Chart]",
        )
        unsafe_image = sanitize_rich_html(
            '<img src="data:text/html;base64,PHNjcmlwdD4=" alt="Unsafe">'
        )
        self.assertNotIn("data:text/html", unsafe_image)

    def test_write_requests_require_csrf_token(self):
        self.register()
        response = self.client.post("/api/projects", json={"title": "No token"})
        self.assertEqual(response.status_code, 403)

    def test_root_and_health_routes_serve_the_python_app(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"Research OS", page.data)
        self.assertIn(b"Manuscript Editor", page.data)
        self.assertIn(b"Frameworkshop", page.data)
        script = self.client.get("/static/app.js")
        self.assertEqual(script.status_code, 200)
        self.assertIn(b"renderToken", script.data)
        script.close()
        self.assertEqual(self.client.get("/api/health").get_json()["status"], "ok")

    def test_postgres_connection_translates_parameters_and_defaults_to_ssl(self):
        self.assertEqual(
            PostgresConnection._postgres_placeholders("SELECT ?, '?' AS literal, \"?\" AS quoted"),
            "SELECT %s, '?' AS literal, \"?\" AS quoted",
        )
        if app.config["DATABASE_URL"]:
            self.skipTest("PostgreSQL connection test requires the local SQLite test configuration.")
        with patch("app.psycopg.connect") as connect:
            app.config["DATABASE_URL"] = "postgresql://db.example.org:5432/research"
            try:
                with app.app_context():
                    connection = get_db()
                    connection.execute("SELECT ? AS value", ("test",))
                    connection.close()
                self.assertEqual(connect.call_args.kwargs["sslmode"], "require")
                self.assertIsNotNone(connect.call_args.kwargs["row_factory"])
            finally:
                app.config["DATABASE_URL"] = ""

    def test_validation_does_not_mark_empty_chapters_ready(self):
        self.register()
        project = self.create_project()
        response = self.client.post(
            "/api/export/validate",
            json={"project_id": project["id"]},
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["ready_for_researcher_review"])
        self.assertEqual(len(response.get_json()["issues"]), 5)

    def test_statistics_return_deterministic_values_and_reject_bad_data(self):
        result = calculate_statistic({"method": "descriptive", "values": [10, 20, 30, 40]})
        self.assertEqual(result["result"]["mean"], 25)
        self.assertEqual(result["result"]["median"], 25)
        self.assertEqual(result["result"]["sample_standard_deviation"], 12.909944)
        with self.assertRaises(ValueError):
            calculate_statistic({"method": "descriptive", "values": [1, float("nan")]})
        with self.assertRaisesRegex(ValueError, "variation"):
            calculate_statistic({"method": "pearson", "x": [1, 1, 1], "y": [2, 3, 4]})
        with self.assertRaisesRegex(ValueError, "zero variance"):
            calculate_statistic({"method": "independent_t", "group_a": [1, 1], "group_b": [2, 2]})
        with self.assertRaisesRegex(ValueError, "distinct values"):
            calculate_statistic({"method": "kruskal_wallis", "groups": [[1, 1], [1, 1]]})
        with self.assertRaisesRegex(ValueError, "100,000"):
            calculate_statistic({"method": "descriptive", "values": [1] * 100_001})

    def test_statistics_catalog_lists_the_available_tests(self):
        response = self.client.get("/api/statistics/catalog")
        self.assertEqual(response.status_code, 200)
        method_ids = {method["id"] for method in response.get_json()["methods"]}
        self.assertTrue({
            "spearman", "one_sample_t", "paired_t", "mann_whitney",
            "one_way_anova", "chi_square",
        }.issubset(method_ids))

    def test_inferential_statistics_require_an_authenticated_session(self):
        response = self.client.post(
            "/api/statistics/calculate",
            json={"method": "descriptive", "values": [1, 2, 3]},
        )
        self.assertEqual(response.status_code, 401)

    def test_inferential_statistics_include_degrees_of_freedom_and_decision(self):
        t_test = calculate_statistic({
            "method": "independent_t",
            "group_a": [1, 2, 3, 4],
            "group_b": [7, 8, 9, 10],
            "alpha": 0.05,
        })
        self.assertAlmostEqual(t_test["result"]["degrees_of_freedom"], 6)
        self.assertIn(t_test["result"]["decision"], {
            "Reject the null hypothesis", "Fail to reject the null hypothesis",
        })
        kruskal = calculate_statistic({
            "method": "kruskal_wallis",
            "groups": [[1, 2, 2], [4, 5, 6], [7, 8, 9]],
        })
        self.assertEqual(kruskal["result"]["degrees_of_freedom"], 2)
        self.assertTrue(0 <= kruskal["result"]["p_value"] <= 1)

    def test_expanded_inferential_statistics_return_valid_results(self):
        cases = [
            ({
                "method": "one_sample_t", "values": [2, 4, 6, 8], "population_mean": 0,
            }, "degrees_of_freedom"),
            ({
                "method": "paired_t", "x": [2, 4, 5, 8], "y": [1, 2, 2, 5],
            }, "mean_difference"),
            ({
                "method": "spearman", "x": [1, 2, 3, 4, 5], "y": [2, 4, 3, 8, 10],
            }, "rho"),
            ({
                "method": "mann_whitney", "group_a": [1, 2, 3, 4], "group_b": [7, 8, 9, 10],
            }, "u_statistic"),
            ({
                "method": "one_way_anova", "groups": [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
            }, "f_statistic"),
            ({
                "method": "chi_square", "observed": [[10, 20], [20, 10]],
            }, "chi_square"),
        ]
        for payload, expected_key in cases:
            with self.subTest(method=payload["method"]):
                result = calculate_statistic(payload)
                self.assertIn(expected_key, result["result"])
                self.assertTrue(0 <= result["result"]["p_value"] <= 1)
                self.assertIn(result["result"]["decision"], {
                    "Reject the null hypothesis", "Fail to reject the null hypothesis",
                })
        chi_square = calculate_statistic({"method": "chi_square", "observed": [[10, 20], [20, 10]]})
        self.assertTrue(chi_square["result"]["yates_correction_applied"])

    def test_expanded_statistics_reject_invalid_paired_and_contingency_data(self):
        with self.assertRaisesRegex(ValueError, "same number"):
            calculate_statistic({"method": "paired_t", "x": [1, 2], "y": [1, 2, 3]})
        with self.assertRaisesRegex(ValueError, "variation"):
            calculate_statistic({"method": "spearman", "x": [1, 1, 1], "y": [2, 3, 4]})
        with self.assertRaisesRegex(ValueError, "negative"):
            calculate_statistic({"method": "chi_square", "observed": [[1, -1], [2, 3]]})
        with self.assertRaisesRegex(ValueError, "same number"):
            calculate_statistic({"method": "paired_t", "x": [1, 2], "y": [1]})

    def test_statistics_csv_import_supports_delimiters_and_requires_authentication(self):
        unauthenticated = self.client.post(
            "/api/statistics/import",
            data={"file": (io.BytesIO(b"value;group\n1;A\n2;B\n"), "scores.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(unauthenticated.status_code, 401)
        self.register()
        response = self.client.post(
            "/api/statistics/import",
            data={"file": (io.BytesIO(b"value;group\n1;A\n2;B\n"), "scores.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        payload = response.get_json()
        self.assertEqual(payload["headers"], ["value", "group"])
        self.assertEqual(payload["rows"], [["1", "A"], ["2", "B"]])
        self.assertEqual(payload["sheet_name"], "CSV")

    def test_statistics_excel_import_selects_sheet_and_normalizes_headers(self):
        self.register()
        workbook = Workbook()
        first = workbook.active
        first.title = "Summary"
        first.append(["Score", "Cohort", "Score"])
        first.append([9, "Control", 10])
        second = workbook.create_sheet("Analysis")
        second.append(["Before", "After", "Group"])
        second.append([10, 14, "Treatment"])
        second.append([12, 17, "Treatment"])
        file_content = io.BytesIO()
        workbook.save(file_content)
        workbook.close()
        response = self.client.post(
            "/api/statistics/import",
            data={"file": (io.BytesIO(file_content.getvalue()), "study.xlsx"), "sheet_name": "Analysis"},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        payload = response.get_json()
        self.assertEqual(payload["sheet_names"], ["Summary", "Analysis"])
        self.assertEqual(payload["sheet_name"], "Analysis")
        self.assertEqual(payload["headers"], ["Before", "After", "Group"])
        self.assertEqual(payload["rows"], [[10, 14, "Treatment"], [12, 17, "Treatment"]])

    def test_statistics_import_reports_invalid_file_types_and_damaged_workbooks(self):
        self.register()
        unsupported = self.client.post(
            "/api/statistics/import",
            data={"file": (io.BytesIO(b"data"), "study.pdf")},
            content_type="multipart/form-data",
        )
        self.assertEqual(unsupported.status_code, 400)
        damaged = self.client.post(
            "/api/statistics/import",
            data={"file": (io.BytesIO(b"not an Excel file"), "study.xlsx")},
            content_type="multipart/form-data",
        )
        self.assertEqual(damaged.status_code, 400)

    def test_citation_generation_does_not_invent_missing_metadata(self):
        response = self.client.post("/api/citations/generate", json={
            "authors": [{"lastName": "Smith"}],
            "publication_year": 2024,
            "style": "parenthetical",
            "source_type": "journal_article",
            "title": "A verified study",
            "journal": "Journal of Testing",
            "doi": "10.1000/example",
        })
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["in_text"], "(Smith, 2024)")
        self.assertIn("https://doi.org/10.1000/example", response.get_json()["reference"])
        full_doi = self.client.post("/api/citations/generate", json={
            "authors": [{"lastName": "Smith"}],
            "publication_year": 2024,
            "title": "A verified study",
            "doi": "https://doi.org/10.1000/example",
        })
        self.assertNotIn("doi.org/https://", full_doi.get_json()["reference"])

    def test_apa7_citation_generator_formats_journal_book_and_no_author_sources(self):
        journal = self.client.post("/api/citations/generate", json={
            "authors": [
                {"firstName": "John Alex", "lastName": "Smith"},
                {"firstName": "Taylor", "lastName": "Jones"},
            ],
            "publication_year": 2024,
            "source_type": "journal_article",
            "style": "narrative",
            "title": "A study of research",
            "journal": "Journal of Testing",
            "volume": "12",
            "issue": "3",
            "pages": "10-20",
        })
        self.assertEqual(journal.status_code, 200, journal.get_json())
        self.assertEqual(journal.get_json()["in_text"], "Smith and Jones (2024)")
        self.assertEqual(
            journal.get_json()["reference"],
            "Smith, J. A., & Jones, T. (2024). A study of research. Journal of Testing, 12(3), 10-20.",
        )
        self.assertIn(
            {"text": "Journal of Testing", "italic": True},
            journal.get_json()["reference_parts"],
        )

        book = self.client.post("/api/citations/generate", json={
            "authors": [{"firstName": "Jane", "lastName": "Doe"}],
            "publication_year": 2020,
            "source_type": "book",
            "title": "A research handbook",
            "edition": "2",
            "publisher": "Academic Press",
        })
        self.assertEqual(
            book.get_json()["reference"],
            "Doe, J. (2020). A research handbook (2nd ed.). Academic Press.",
        )
        self.assertIn(
            {"text": "A research handbook", "italic": True},
            book.get_json()["reference_parts"],
        )

        no_author = self.client.post("/api/citations/generate", json={
            "source_type": "webpage",
            "title": "Research guidance",
            "source_url": "https://example.org/research",
        })
        self.assertEqual(no_author.get_json()["in_text"], "(Research guidance, n.d.)")
        self.assertTrue(any("Author information is missing" in warning for warning in no_author.get_json()["warnings"]))
        narrative_no_author = self.client.post("/api/citations/generate", json={
            "source_type": "book",
            "style": "narrative",
            "title": "Research methods",
            "publication_year": 2022,
        })
        self.assertEqual(narrative_no_author.get_json()["in_text"], "Research methods (2022)")

    def test_citation_doi_lookup_uses_crossref_metadata(self):
        provider_response = io.BytesIO(json.dumps({
            "message": {
                "DOI": "10.1000/verified",
                "title": ["Provider article"],
                "author": [{"given": "Jane A.", "family": "Scholar"}],
                "published-print": {"date-parts": [[2023, 5, 12]]},
                "container-title": ["Verified Journal"],
                "volume": "8",
                "issue": "2",
                "page": "12-20",
                "URL": "https://doi.org/10.1000/verified",
                "type": "journal-article",
                "publisher": "Verified Press",
            },
        }).encode())
        with patch("app.urlopen", return_value=provider_response):
            response = self.client.get("/api/citations/lookup?doi=10.1000%2Fverified")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["provider"], "Crossref")
        self.assertEqual(response.get_json()["source"]["source_type"], "journal_article")
        self.assertEqual(response.get_json()["source"]["authors"][0]["lastName"], "Scholar")
        self.assertEqual(response.get_json()["source"]["publication_year"], 2023)
        self.assertEqual(response.get_json()["source"]["volume"], "8")

    def test_citation_url_lookup_resolves_doi_and_crossref_url_matches(self):
        doi_record = {
            "DOI": "10.1000/verified",
            "title": ["Provider article"],
            "author": [{"given": "Jane A.", "family": "Scholar"}],
            "published-print": {"date-parts": [[2023]]},
            "container-title": ["Verified Journal"],
            "type": "journal-article",
            "URL": "https://doi.org/10.1000/verified",
        }
        with patch("app.fetch_crossref_doi", return_value=doi_record):
            doi_response = self.client.get(
                "/api/citations/lookup-url?url=https%3A%2F%2Fdoi.org%2F10.1000%2Fverified"
            )
        self.assertEqual(doi_response.status_code, 200, doi_response.get_json())
        self.assertEqual(doi_response.get_json()["source"]["title"], "Provider article")

        search_record = {
            **doi_record,
            "DOI": "10.1000/search-match",
            "title": ["Matched article"],
        }
        provider_response = io.BytesIO(json.dumps({
            "message": {"items": [search_record]},
        }).encode())
        with patch("app.urlopen", return_value=provider_response) as urlopen:
            response = self.client.get(
                "/api/citations/lookup-url?url=https%3A%2F%2Fexample.org%2Farticle"
            )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["matches"][0]["title"], "Matched article")
        self.assertIn("api.crossref.org/works?", urlopen.call_args.args[0].full_url)

    def test_citation_url_lookup_requires_safe_http_url(self):
        missing = self.client.get("/api/citations/lookup-url")
        self.assertEqual(missing.status_code, 400)
        invalid = self.client.get("/api/citations/lookup-url?url=file%3A%2F%2F%2Fetc%2Fpasswd")
        self.assertEqual(invalid.status_code, 400)

    def test_citation_generator_rejects_bad_source_type_and_doi(self):
        bad_type = self.client.post("/api/citations/generate", json={
            "title": "A title",
            "source_type": "unknown",
        })
        self.assertEqual(bad_type.status_code, 400)
        malformed_type = self.client.post("/api/citations/generate", json={
            "title": "A title",
            "source_type": [],
        })
        self.assertEqual(malformed_type.status_code, 400)
        bad_doi = self.client.get("/api/citations/lookup?doi=not-a-doi")
        self.assertEqual(bad_doi.status_code, 400)

    def test_crossref_verified_metadata_is_fetched_server_side(self):
        self.register()
        project = self.create_project()
        provider_response = io.BytesIO(json.dumps({
            "message": {
                "DOI": "10.1000/verified",
                "title": ["Provider-confirmed title"],
                "author": [{"given": "Verified Author", "family": "Scholar"}],
                "published-online": {"date-parts": [[2023]]},
                "container-title": ["Verified Journal"],
                "URL": "https://doi.org/10.1000/verified",
                "type": "journal-article",
                "publisher": "Verified Press",
            },
        }).encode())
        with patch("app.urlopen", return_value=provider_response):
            response = self.client.post(
                f"/api/projects/{project['id']}/sources",
                headers=self.write_headers(),
                json={
                    "title": "Forged title",
                    "authors": [{"lastName": "Forged"}],
                    "publication_year": 1999,
                    "doi": "10.1000/verified",
                    "metadata_verified": True,
                },
            )
        self.assertEqual(response.status_code, 201)
        saved = self.client.get(f"/api/projects/{project['id']}/sources").get_json()["sources"][0]
        self.assertEqual(saved["title"], "Provider-confirmed title")
        self.assertEqual(saved["authors"][0]["lastName"], "Scholar")
        self.assertEqual(saved["publication_year"], 2023)
        self.assertEqual(saved["metadata_verified"], 1)

    def test_user_cannot_mark_unverified_source_as_verified_or_add_javascript_url(self):
        self.register()
        project = self.create_project()
        response = self.client.post(
            f"/api/projects/{project['id']}/sources",
            headers=self.write_headers(),
            json={"title": "Unverified", "metadata_verified": True},
        )
        self.assertEqual(response.status_code, 201)
        saved = self.client.get(f"/api/projects/{project['id']}/sources").get_json()["sources"][0]
        self.assertEqual(saved["metadata_verified"], 0)
        invalid_url = self.client.post(
            f"/api/projects/{project['id']}/sources",
            headers=self.write_headers(),
            json={"title": "Unsafe link", "source_url": "javascript:alert(1)"},
        )
        self.assertEqual(invalid_url.status_code, 400)

    def test_ai_failures_return_an_explicit_service_error(self):
        self.register()
        with self.assertLogs("research_os", level="ERROR"):
            with patch("app.ask_json", side_effect=RuntimeError("GEMINI_API_KEY is missing")):
                response = self.client.post(
                    "/api/writing/grammar",
                    json={"text": "A short research paragraph."},
                )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"]["code"], "ai_service_unavailable")
        self.assertNotIn("GEMINI_API_KEY", response.get_data(as_text=True))

    def test_writing_pattern_analysis_includes_grammar_review(self):
        self.register()
        result = {
            "likelihood": 42,
            "label": "Mixed signals",
            "patterns": ["Repeated sentence structures"],
            "sentences": [],
            "issues": [{
                "original": "They was",
                "category": "Grammar",
                "explanation": "Subject and verb do not agree.",
                "suggestion": "They were",
                "severity": "medium",
            }],
        }
        with patch("app.ask_json", return_value=result) as ask_json:
            response = self.client.post("/api/writing/ai-analysis", json={"text": "They was ready."})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["issues"][0]["suggestion"], "They were")
        self.assertIn("grammar or spelling problems", ask_json.call_args.args[0])

    def test_ai_service_parses_json_from_generate_content(self):
        response = type("Response", (), {"text": '{"draft":"A sample research draft."}'})()
        with patch("ai_service.client") as client:
            client.return_value.models.generate_content.return_value = response
            result = ai_service.ask_json("Return JSON.", "Write a sample paragraph.", retries=1)
        self.assertEqual(result, {"draft": "A sample research draft."})
        self.assertEqual(
            client.return_value.models.generate_content.call_args.kwargs["model"],
            ai_service.MODEL,
        )
        self.assertEqual(
            client.return_value.models.generate_content.call_args.kwargs["config"].response_mime_type,
            "application/json",
        )

    def test_appendix_upload_stores_original_and_checks_ownership(self):
        self.register()
        project = self.create_project()
        upload = self.client.post(
            f"/api/projects/{project['id']}/appendices",
            data={
                "file": (io.BytesIO(b"research data"), "notes.txt"),
                "title": "Research notes",
            },
            headers=self.write_headers(),
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 201, upload.get_json())
        appendix_id = upload.get_json()["id"]
        download = self.client.get(f"/api/appendices/{appendix_id}/download")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.data, b"research data")
        download.close()
        preview = self.client.get(f"/api/appendices/{appendix_id}/preview")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data, b"research data")
        self.assertEqual(preview.mimetype, "text/plain")
        self.assertEqual(preview.headers["X-Content-Type-Options"], "nosniff")
        preview.close()
        self.client.post("/api/auth/logout", json={}, headers=self.write_headers())
        self.register("another@example.org")
        private_download = self.client.get(f"/api/appendices/{appendix_id}/download")
        self.assertEqual(private_download.status_code, 404)
        private_preview = self.client.get(f"/api/appendices/{appendix_id}/preview")
        self.assertEqual(private_preview.status_code, 404)

    def test_deleted_appendix_does_not_cause_duplicate_labels(self):
        self.register()
        project = self.create_project()

        def upload(name):
            return self.client.post(
                f"/api/projects/{project['id']}/appendices",
                data={"file": (io.BytesIO(name.encode()), f"{name}.txt")},
                headers=self.write_headers(),
                content_type="multipart/form-data",
            )

        first = upload("first").get_json()
        second = upload("second").get_json()
        self.assertEqual((first["appendix_letter"], second["appendix_letter"]), ("A", "B"))
        self.client.delete(f"/api/appendices/{first['id']}", headers=self.write_headers())
        third = upload("third").get_json()
        self.assertEqual(third["appendix_letter"], "C")

    def test_crossref_search_uses_provider_metadata(self):
        self.register()
        provider_response = io.BytesIO(json.dumps({
            "message": {"items": [{
                "title": ["A provider record"],
                "author": [{"given": "A. B.", "family": "Researcher"}],
                "published-print": {"date-parts": [[2024, 2]]},
                "DOI": "10.1000/provider",
                "URL": "https://doi.org/10.1000/provider",
                "container-title": ["Research Journal"],
            }]},
        }).encode())
        with patch("app.urlopen", return_value=provider_response):
            response = self.client.get("/api/literature/search?q=research")
        self.assertEqual(response.status_code, 200)
        record = response.get_json()["results"][0]
        self.assertEqual(record["title"], "A provider record")
        self.assertEqual(record["authors"][0]["lastName"], "Researcher")
        self.assertEqual(record["publication_year"], 2024)
        self.assertTrue(record["metadata_verified"])

    @unittest.skipIf(__import__("app").Document is None, "python-docx is not installed")
    def test_docx_export_returns_an_editable_word_document(self):
        self.register()
        project = self.create_project()
        document = self.client.get(f"/api/projects/{project['id']}/documents").get_json()["documents"][0]
        response = self.client.put(
            f"/api/documents/{document['id']}/autosave",
            json={"content": {"sections": [{"title": "Subsection", "content": "Editable text.", "level": 2}]}},
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 200)
        response = self.client.post(
            "/api/export/docx",
            json={"project_id": project["id"]},
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.mimetype,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        self.assertTrue(response.data.startswith(b"PK"))
        word_document = __import__("app").Document(io.BytesIO(response.data))
        heading = next(paragraph for paragraph in word_document.paragraphs if paragraph.text == "Subsection")
        self.assertEqual(heading.style.name, "Heading 2")
        get_response = self.client.get(f"/api/export/docx?project_id={project['id']}")
        self.assertEqual(get_response.status_code, 200)
        self.assertIn("attachment", get_response.headers.get("Content-Disposition", ""))

    @unittest.skipIf(__import__("app").SimpleDocTemplate is None, "ReportLab is not installed")
    def test_pdf_export_returns_a_pdf(self):
        self.register()
        project = self.create_project()
        response = self.client.post(
            "/api/export/pdf",
            json={"project_id": project["id"]},
            headers=self.write_headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/pdf")
        self.assertTrue(response.data.startswith(b"%PDF"))
        get_response = self.client.get(f"/api/export/pdf?project_id={project['id']}")
        self.assertEqual(get_response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
