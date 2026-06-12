# v0.0.9.34 — App package renamed to "kavach". The MODULE stays
# "Stock Reconciliation Tracking" (folder kavach/stock_reconciliation_tracking/),
# so the SRT Dashboard lives under Kavach like Manufacturing under ERPNext.
# Kavach shows as a tile on the /apps desktop screen (add_to_apps_screen,
# below) and in the navbar/app switcher via app_logo_url. Logo + icon wiring
# mirrors the yoddha app.
app_name = "kavach"
app_title = "Kavach"
app_publisher = "chaizup"
app_description = "Kavach — stock audit & reconciliation (ERPNext Stock Reconciliation wrapper: count → audit → approve)"
app_email = "dev@chaizup.in"
app_license = "mit"
app_logo_url = "/assets/kavach/images/kavach-logo.svg"
app_icon_url = "/assets/kavach/images/kavach-logo.svg"
app_icon = "kavach-logo.svg"

# Show Kavach as a tile on the /apps desktop screen (the app grid users land
# on), with the Kavach shield logo, routing into the Kavach workspace.
add_to_apps_screen = [
    {
        "name": "kavach",
        "logo": "/assets/kavach/images/kavach-logo.svg",
        "title": "Kavach",
        "route": "/desk/kavach",
    }
]

# Register the Kavach icon sprite (yoddha-style) so custom workspace icons
# resolve. Symbol id "icon-kavach-srt" → use as workspace icon "kavach-srt"
# (the Stock Reconciliation module's clipboard logo), distinct from the app's
# shield logo (app_logo_url). Add more <symbol>s to kavach-icons.svg + set a
# workspace's `icon` to the symbol id minus the "icon-" prefix.
app_include_icons = ["/assets/kavach/icons/kavach-icons.svg"]

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "kavach",
# 		"logo": "/assets/kavach/logo.png",
# 		"title": "Stock Reconciliation Tracking",
# 		"route": "/kavach",
# 		"has_permission": "kavach.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/kavach/css/kavach.css"
# app_include_js = "/assets/kavach/js/kavach.js"

# include js, css files in header of web template
# web_include_css = "/assets/kavach/css/kavach.css"
# web_include_js = "/assets/kavach/js/kavach.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "kavach/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "kavach/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "kavach.utils.jinja_methods",
# 	"filters": "kavach.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "kavach.install.before_install"
after_install = "kavach.install.after_install"
after_migrate = "kavach.install.after_migrate"

# Uninstallation
# ------------

# before_uninstall = "kavach.uninstall.before_uninstall"
# after_uninstall = "kavach.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "kavach.utils.before_app_install"
# after_app_install = "kavach.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "kavach.utils.before_app_uninstall"
# after_app_uninstall = "kavach.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "kavach.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "kavach.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Kavach Mobile — push notifications.
# When Frappe records a Notification Log for a user (assignments, workflow
# alerts, mentions, warnings), fan it out to that user's registered Expo push
# tokens. Best-effort: send_push_on_notification_log swallows + logs failures so
# the notification itself is never blocked. See mobile_api.py § 4.
doc_events = {
	"Notification Log": {
		"after_insert": "kavach.stock_reconciliation_tracking.mobile_api.send_push_on_notification_log"
	},
	"Kavach Notification": {
		"after_insert": "kavach.stock_reconciliation_tracking.mobile_api.send_push_on_kavach_notification"
	},
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"kavach.tasks.all"
# 	],
# 	"daily": [
# 		"kavach.tasks.daily"
# 	],
# 	"hourly": [
# 		"kavach.tasks.hourly"
# 	],
# 	"weekly": [
# 		"kavach.tasks.weekly"
# 	],
# 	"monthly": [
# 		"kavach.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "kavach.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "kavach.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "kavach.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "kavach.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["kavach.utils.before_request"]
# after_request = ["kavach.utils.after_request"]

# Job Events
# ----------
# before_job = ["kavach.utils.before_job"]
# after_job = ["kavach.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"kavach.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

