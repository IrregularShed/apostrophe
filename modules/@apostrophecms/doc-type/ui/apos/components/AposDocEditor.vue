<template>
  <AposModal
    class="apos-doc-editor" :modal="modal"
    :modal-title="modalTitle"
    @inactive="modal.active = false" @show-modal="modal.showModal = true"
    @esc="confirmAndCancel" @no-modal="$emit('safe-close')"
  >
    <template #secondaryControls>
      <AposButton
        type="default" label="Cancel"
        @click="confirmAndCancel"
      />
    </template>
    <template #primaryControls>
      <AposDocContextMenu
        v-if="original"
        :disabled="(errorCount > 0) || restoreOnly"
        :doc="original"
        :current="docFields.data"
        :published="published"
        :show-edit="false"
        @close="close"
      />
      <AposButton
        v-if="restoreOnly"
        type="primary" :label="saveLabel"
        :disabled="saveDisabled"
        @click="onRestore"
        :tooltip="tooltip"
      />
      <AposButtonSplit
        v-else-if="saveMenu"
        :menu="saveMenu"
        menu-label="Select Save Method"
        :disabled="saveDisabled"
        :tooltip="tooltip"
        :selected="savePreference"
        @click="saveHandler($event)"
      />
    </template>
    <template #leftRail>
      <AposModalRail>
        <AposModalTabs
          :key="tabKey"
          v-if="tabs.length > 0"
          :current="currentTab"
          :tabs="tabs"
          :errors="fieldErrors"
          @select-tab="switchPane"
        />
      </AposModalRail>
    </template>
    <template #main>
      <AposModalBody>
        <template #bodyMain>
          <div v-if="docReady" class="apos-doc-editor__body">
            <AposSchema
              v-for="tab in tabs"
              v-show="tab.name === currentTab"
              :key="tab.name"
              :changed="changed"
              :schema="groups[tab.name].schema"
              :current-fields="groups[tab.name].fields"
              :trigger-validation="triggerValidation"
              :utility-rail="false"
              :following-values="followingValues('other')"
              :conditional-fields="conditionalFields('other')"
              :doc-id="docId"
              :value="docFields"
              @input="updateDocFields"
              :server-errors="serverErrors"
              :ref="tab.name"
            />
          </div>
        </template>
      </AposModalBody>
    </template>
    <template #rightRail>
      <AposModalRail type="right">
        <div class="apos-doc-editor__utility">
          <AposSchema
            v-if="docReady"
            :schema="groups['utility'].schema"
            :changed="changed"
            :current-fields="groups['utility'].fields"
            :trigger-validation="triggerValidation"
            :utility-rail="true"
            :following-values="followingUtils"
            :conditional-fields="conditionalFields('utility')"
            :doc-id="docId"
            :value="docFields"
            @input="updateDocFields"
            :modifiers="['small', 'inverted']"
            ref="utilitySchema"
            :server-errors="serverErrors"
          />
        </div>
      </AposModalRail>
    </template>
  </AposModal>
</template>

<script>
import AposModifiedMixin from 'Modules/@apostrophecms/ui/mixins/AposModifiedMixin';
import AposModalTabsMixin from 'Modules/@apostrophecms/modal/mixins/AposModalTabsMixin';
import AposEditorMixin from 'Modules/@apostrophecms/modal/mixins/AposEditorMixin';
import AposPublishMixin from 'Modules/@apostrophecms/ui/mixins/AposPublishMixin';
import AposArchiveMixin from 'Modules/@apostrophecms/ui/mixins/AposArchiveMixin';
import AposAdvisoryLockMixin from 'Modules/@apostrophecms/ui/mixins/AposAdvisoryLockMixin';
import { detectDocChange } from 'Modules/@apostrophecms/schema/lib/detectChange';
import { klona } from 'klona';
import cuid from 'cuid';

export default {
  name: 'AposDocEditor',
  mixins: [
    AposModalTabsMixin,
    AposModifiedMixin,
    AposEditorMixin,
    AposPublishMixin,
    AposAdvisoryLockMixin,
    AposArchiveMixin
  ],
  props: {
    moduleName: {
      type: String,
      required: true
    },
    docId: {
      type: String,
      default: null
    },
    copyOf: {
      type: Object,
      default: null
    }
  },
  emits: [ 'modal-result', 'safe-close' ],
  data() {
    return {
      tabKey: cuid(),
      docType: this.moduleName,
      docReady: false,
      fieldErrors: {},
      modal: {
        active: false,
        type: 'overlay',
        showModal: false
      },
      triggerValidation: false,
      original: null,
      published: null,
      errorCount: 0,
      restoreOnly: false,
      saveMenu: null
    };
  },
  computed: {
    getOnePath() {
      return `${this.moduleAction}/${this.docId}`;
    },
    tooltip() {
      // TODO I18N
      let msg;
      if (this.errorCount) {
        msg = `${this.errorCount} error${this.errorCount > 1 ? 's' : ''} remaining`;
      }
      return msg;
    },
    followingUtils() {
      return this.followingValues('utility');
    },
    saveDisabled() {
      if (this.restoreOnly) {
        // Can always restore if it's a read-only view of the archive
        return false;
      }
      if (this.errorCount) {
        // Always block save if there are errors in the modal
        return true;
      }
      if (!this.docId) {
        // If it is new you can always save it, even just to insert it with
        // defaults is sometimes useful
        return false;
      }
      if (this.isModified) {
        // If it has been modified in the modal you can always save it
        return false;
      }
      // If it is not manually published this is a simple "save" operation,
      // don't allow it since the doc is unmodified in the modal
      if (!this.manuallyPublished) {
        return true;
      }
      if (this.moduleOptions.canPublish) {
        // Primary button is "publish". If it is previously published and the
        // draft is not modified since then, don't allow it
        return this.published && !this.isModifiedFromPublished;
      }
      if (!this.original) {
        // There is an id but no original — that means we're still loading the
        // original — block until ready
        return true;
      }
      // Contributor case. Button is "submit"
      // If previously published and not modified since, we can't submit
      if (this.published && !this.isModifiedFromPublished) {
        return true;
      }
      if (!this.original.submitted) {
        // Allow initial submission
        return false;
      }
      // Block re-submission of an unmodified draft (we already checked modified)
      return true;
    },
    moduleOptions() {
      return window.apos.modules[this.docType] || {};
    },
    moduleAction () {
      // Use moduleName for the action since all page types use the
      // `@apostrophecms/page` module action.
      return (window.apos.modules[this.moduleName] || {}).action;
    },
    groups() {
      const groupSet = {};

      this.schema.forEach(field => {
        if (!this.filterOutParkedFields([ field.name ]).length) {
          return;
        }
        if (field.group && !groupSet[field.group.name]) {
          groupSet[field.group.name] = {
            label: field.group.label,
            fields: [ field.name ],
            schema: [ field ]
          };
        } else if (field.group) {
          groupSet[field.group.name].fields.push(field.name);
          groupSet[field.group.name].schema.push(field);
        }
      });
      if (!groupSet.utility) {
        groupSet.utility = {
          label: 'Utility',
          fields: [],
          schema: []
        };
      }
      return groupSet;
    },
    utilityFields() {
      let fields = [];
      if (this.groups.utility && this.groups.utility.fields) {
        fields = this.groups.utility.fields;
      }
      return this.filterOutParkedFields(fields);
    },
    tabs() {
      const tabs = [];
      for (const key in this.groups) {
        if (key !== 'utility') {
          tabs.push({
            name: key,
            label: this.groups[key].label
          });
        }
      };
      return tabs;
    },
    modalTitle() {
      if (this.docId) {
        return `Edit ${this.moduleOptions.label || ''}`;
      } else {
        return `New ${this.moduleOptions.label || ''}`;
      }
    },
    currentFields() {
      if (this.currentTab) {
        const tabFields = this.tabs.find((item) => {
          return item.name === this.currentTab;
        });
        return this.filterOutParkedFields(tabFields.fields);
      } else {
        return [];
      }
    },
    saveLabel() {
      if (this.restoreOnly) {
        return 'Restore';
      } else if (this.manuallyPublished) {
        if (this.moduleOptions.canPublish) {
          if (this.copyOf) {
            return 'Publish';
          } else if (this.original && this.original.lastPublishedAt) {
            return 'Update';
          } else {
            return 'Publish';
          }
        } else {
          if (this.copyOf) {
            return 'Submit';
          } else if (this.original && this.original.lastPublishedAt) {
            return 'Submit Update';
          } else {
            return 'Submit';
          }
        }
      } else {
        return 'Save';
      }
    },
    isModified() {
      if (!this.original) {
        return false;
      }
      return detectDocChange(this.schema, this.original, this.docFields.data);
    },
    isModifiedFromPublished() {
      if (!this.published) {
        return false;
      }
      return detectDocChange(this.schema, this.published, this.docFields.data);
    },
    savePreferenceName() {
      return `apos-${this.moduleName}-save-pref`;
    },
    savePreference() {
      let pref = window.localStorage.getItem(this.savePreferenceName);
      if (typeof pref !== 'string') {
        pref = null;
      }
      return pref;
    }
  },
  watch: {
    'docFields.data.type': {
      handler(newVal, oldVal) {
        if (this.moduleName !== '@apostrophecms/page') {
          return;
        }
        if (this.docType !== newVal) {
          this.docType = newVal;
          this.prepErrors();
        }
      }
    },
    // comes in late for pages
    manuallyPublished() {
      this.saveMenu = this.computeSaveMenu();
    },
    original() {
      this.saveMenu = this.computeSaveMenu();
    },
    tabs() {
      if ((!this.currentTab) || (!this.tabs.find(tab => tab.name === this.currentTab))) {
        this.currentTab = this.tabs[0] && this.tabs[0].name;
      }
    }

  },
  async mounted() {
    this.modal.active = true;
    // After computed properties become available
    this.saveMenu = this.computeSaveMenu();
    this.cancelDescription = `Do you want to discard changes to this ${this.moduleOptions.label.toLowerCase()}?`;
    if (this.docId) {
      await this.loadDoc();
      try {
        if (this.manuallyPublished) {
          this.published = await apos.http.get(this.getOnePath, {
            busy: true,
            qs: {
              archived: 'any',
              aposMode: 'published'
            }
          });
        }
      } catch (e) {
        if (e.name !== 'notfound') {
          console.error(e);
          // TODO a nicer message here, but moduleLabels is undefined here
          await apos.notify('An error occurred fetching the published version of the document.', {
            type: 'warning',
            icon: 'alert-circle-icon',
            dismiss: true
          });
        }
      }
    } else if (this.copyOf) {
      const newInstance = klona(this.copyOf);
      delete newInstance.parked;
      newInstance.title = `Copy of ${this.copyOf.title}`;
      if (this.copyOf.slug.startsWith('/')) {
        const matches = this.copyOf.slug.match(/\/([^/]+)$/);
        if (matches) {
          newInstance.slug = `${apos.page.page.slug}/copy-of-${matches[1]}`;
        } else {
          newInstance.slug = '/copy-of-home-page';
        }
      } else {
        newInstance.slug = this.copyOf.slug.replace(/([^/]+)$/, 'copy-of-$1');
      }
      delete newInstance._id;
      delete newInstance._url;

      this.original = newInstance;

      if (newInstance && newInstance.type !== this.docType) {
        this.docType = newInstance.type;
      }
      this.docFields.data = newInstance;
      this.prepErrors();
      this.docReady = true;
    } else {
      this.$nextTick(() => {
        this.loadNewInstance();
      });
    }
    apos.bus.$on('content-changed', this.onContentChanged);
  },
  destroyed() {
    apos.bus.$off('content-changed', this.onContentChanged);
  },
  methods: {
    async saveHandler(action) {
      this.triggerValidation = true;
      this.$nextTick(async () => {
        if (this.savePreference !== action) {
          this.setSavePreference(action);
        }
        if (!this.errorCount) {
          this[action]();
        } else {
          await apos.notify('Resolve errors before saving.', {
            type: 'warning',
            icon: 'alert-circle-icon',
            dismiss: true
          });
          this.focusNextError();
        }
      });
    },
    async loadDoc() {
      let docData;
      try {
        if (!await this.lock(this.getOnePath, this.docId)) {
          await this.lockNotAvailable();
          return;
        }
        docData = await apos.http.get(this.getOnePath, {
          busy: true,
          qs: {
            archived: 'any'
          },
          draft: true
        });

        if (docData.archived) {
          this.restoreOnly = true;
        } else {
          this.restoreOnly = false;
        }
      } catch {
        // TODO a nicer message here, but moduleLabels is undefined here
        await apos.notify('The requested document was not found.', {
          type: 'warning',
          icon: 'alert-circle-icon',
          dismiss: true
        });
        await this.confirmAndCancel();
      } finally {
        if (docData) {
          if (docData.type !== this.docType) {
            this.docType = docData.type;
          }
          this.original = klona(docData);
          this.docFields.data = docData;
          if (this.published) {
            this.changed = detectDocChange(this.schema, this.original, this.published, { differences: true });
          }
          this.docReady = true;
          this.prepErrors();
        }
      }
    },
    async preview() {
      if (!await this.confirmAndCancel()) {
        return;
      }
      window.location = this.original._url;
    },
    updateFieldState(fieldState) {
      this.tabKey = cuid();
      for (const key in this.groups) {
        this.groups[key].fields.forEach(field => {
          if (fieldState[field]) {
            this.fieldErrors[key][field] = fieldState[field].error;
          }
        });
      }
      this.updateErrorCount();
    },
    updateErrorCount() {
      let count = 0;
      for (const key in this.fieldErrors) {
        for (const tabKey in this.fieldErrors[key]) {
          if (this.fieldErrors[key][tabKey]) {
            count++;
          }
        }
      }
      this.errorCount = count;
    },
    focusNextError() {
      let field;
      for (const key in this.fieldErrors) {
        for (const tabKey in this.fieldErrors[key]) {
          if (this.fieldErrors[key][tabKey] && !field) {
            field = this.schema.filter(item => {
              return item.name === tabKey;
            })[0];
            this.switchPane(field.group.name);
            this.getAposSchema(field).scrollFieldIntoView(field.name);
          }
        }
      }
    },
    prepErrors() {
      for (const name in this.groups) {
        this.fieldErrors[name] = {};
      }
    },
    // Implementing a method expected by the advisory lock mixin
    lockNotAvailable() {
      this.modal.showModal = false;
    },
    async onRestore() {
      await this.restore(this.original);
      await this.loadDoc();
    },
    async onSave(navigate = false) {
      if (this.moduleOptions.canPublish || !this.manuallyPublished) {
        await this.save({
          andPublish: this.manuallyPublished,
          navigate
        });
      } else {
        await this.save({
          andPublish: false,
          andSubmit: true,
          navigate
        });
      }
    },
    async onSaveAndView() {
      await this.onSave({ navigate: true });
    },
    async onSaveAndNew() {
      await this.onSave();
      this.startNew();
    },
    async onSaveDraftAndNew() {
      await this.onSaveDraft();
      this.startNew();
    },
    async onSaveDraftAndView() {
      await this.onSaveDraft({ navigate: true });
    },
    async onSaveDraft(navigate = false) {
      await this.save({
        andPublish: false,
        navigate
      });
      await apos.notify('Draft saved', {
        type: 'success',
        dismiss: true,
        icon: 'file-document-icon'
      });
    },
    // If andPublish is true, publish after saving.
    async save({
      andPublish = false,
      navigate = false,
      andSubmit = false
    }) {
      const body = this.docFields.data;
      let route;
      let requestMethod;
      if (this.docId) {
        route = `${this.moduleAction}/${this.docId}`;
        requestMethod = apos.http.put;
        this.addLockToRequest(body);
      } else {
        route = this.moduleAction;
        requestMethod = apos.http.post;

        if (this.moduleName === '@apostrophecms/page') {
          // New pages are always born as drafts
          body._targetId = apos.page.page._id.replace(':published', ':draft');
          body._position = 'lastChild';
        }
        if (this.copyOf) {
          body._copyingId = this.copyOf._id;
        }
      }
      let doc;
      try {
        doc = await requestMethod(route, {
          busy: true,
          body,
          draft: true
        });
        if (andSubmit) {
          await this.submitDraft(doc);
        } else if (andPublish) {
          await this.publish(doc);
        }
        apos.bus.$emit('content-changed', {
          doc,
          action: (requestMethod === apos.http.put) ? 'update' : 'insert'
        });
      } catch (e) {
        if (this.isLockedError(e)) {
          await this.showLockedError(e);
          this.modal.showModal = false;
          return;
        } else {
          await this.handleSaveError(e, {
            fallback: 'An error occurred saving the document.'
          });
          return;
        }
      }
      this.$emit('modal-result', doc);
      this.modal.showModal = false;
      if (navigate) {
        if (doc._url) {
          window.location = doc._url;
        } else {
          const subject = andPublish ? 'Document published' : 'Draft saved';
          await apos.notify(`${subject} but could not navigate to a preview.`, {
            type: 'warning',
            icon: 'alert-circle-icon'
          });
        }
      }
    },
    async getNewInstance() {
      try {
        const body = {
          _newInstance: true
        };

        if (this.moduleName === '@apostrophecms/page') {
          // New pages are always born as drafts
          body._targetId = apos.page.page._id.replace(':published', ':draft');
          body._position = 'lastChild';
        }
        const newDoc = await apos.http.post(this.moduleAction, {
          body,
          draft: true
        });
        return newDoc;
      } catch (error) {
        await apos.notify('Error while creating new, empty content.', {
          type: 'danger',
          icon: 'alert-circle-icon',
          dismiss: true
        });

        console.error(`Error while creating new, empty content. Review your configuration for ${this.docType} (including \`type\` options in \`@apostrophecms/page\` if it's a page type).`);

        this.modal.showModal = false;
      }
    },
    async loadNewInstance () {
      this.docReady = false;
      const newInstance = await this.getNewInstance();
      this.original = newInstance;
      if (newInstance && newInstance.type !== this.docType) {
        this.docType = newInstance.type;
      }
      this.docFields.data = newInstance;
      const slugField = this.schema.find(field => field.name === 'slug');
      if (slugField) {
        // As a matter of UI implementation, we know our slug input field will
        // automatically change the empty string to the prefix, so to
        // prevent a false positive for this being considered a change,
        // do it earlier when creating a new user
        this.original.slug = this.original.slug || slugField.def || slugField.prefix || '';
      }
      this.prepErrors();
      this.docReady = true;
    },
    startNew() {
      this.modal.showModal = false;
      apos.bus.$emit('admin-menu-click', {
        itemName: `${this.moduleName}:editor`
      });
    },
    updateDocFields(value) {
      this.updateFieldState(value.fieldState);
      this.docFields.data = {
        ...this.docFields.data,
        ...value.data
      };
    },
    getAposSchema(field) {
      if (field.group.name === 'utility') {
        return this.$refs.utilitySchema;
      } else {
        return this.$refs[field.group.name][0];
      }
    },
    filterOutParkedFields(fields) {
      return fields.filter(fieldName => {
        return !((this.original && this.original.parked) || []).includes(fieldName);
      });
    },
    computeSaveMenu () {
      // Powers the dropdown Save menu
      // all actions expected to be methods of this component
      // Needs to be manually computed because this.saveLabel doesnt stay reactive when part of an object
      const typeLabel = this.moduleOptions
        ? this.moduleOptions.label.toLowerCase()
        : 'document';
      const isNew = !this.docId;
      // this.original takes a moment to populate, don't crash
      const canPreview = this.original && (this.original._id ? this.original._url : this.original._previewable);
      const canNew = this.moduleOptions.showCreate;
      const menu = [
        {
          label: this.saveLabel,
          action: 'onSave',
          description: isNew
            ? `${this.saveLabel} ${typeLabel} and return to the ${typeLabel} listing.`
            : `${this.saveLabel} updates and return to the ${typeLabel} listing.`,
          def: true
        }
      ];
      if (canPreview) {
        menu.push({
          label: `${this.saveLabel} and View`,
          action: 'onSaveAndView',
          description: isNew
            ? `${this.saveLabel} ${typeLabel} and be redirected to the ${typeLabel}.`
            : `${this.saveLabel} updates and be redirected to the ${typeLabel}.`
        });
      }
      if (canNew) {
        menu.push({
          label: `${this.saveLabel} and Create New`,
          action: 'onSaveAndNew',
          description: isNew
            ? `${this.saveLabel} ${typeLabel} and create a new one.`
            : `${this.saveLabel} updates and create a new ${typeLabel}.`
        });
      }
      if (this.manuallyPublished) {
        menu.push({
          label: 'Save Draft',
          action: 'onSaveDraft',
          description: 'Save as a draft to publish later.'
        });
      }
      if (this.canPreviewDraft && canPreview) {
        menu.push({
          label: 'Save Draft and Preview',
          action: 'onSaveDraftAndView',
          description: `Save as a draft and preview the ${typeLabel}.`
        });
      };
      if (this.manuallyPublished && canNew) {
        menu.push({
          label: 'Save Draft and Create New',
          action: 'onSaveDraftAndNew',
          description: `Save as a draft and create a new ${typeLabel}.`
        });
      }
      return menu;
    },
    setSavePreference(pref) {
      window.localStorage.setItem(this.savePreferenceName, pref);
    },
    onContentChanged(e) {
      if ((e.action === 'archive') || (e.action === 'delete') || (e.action === 'revert-draft-to-published')) {
        this.modal.showModal = false;
      }
    },
    close() {
      this.modal.showModal = false;
    }
  }
};
</script>

<style lang="scss" scoped>
  .apos-doc-editor__body {
    padding-top: 20px;
    max-width: 90%;
    margin-right: auto;
    margin-left: auto;
  }

  .apos-doc-editor__utility {
    padding: 40px 20px;
  }
</style>
