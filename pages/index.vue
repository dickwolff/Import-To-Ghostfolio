<template>
  <div class="max-w-2xl mx-auto p-6 space-y-8">
    <UCard>
      <template #header>
        <h2 class="text-xl font-semibold">Import Broker Data to Ghostfolio</h2>
      </template>

      <div class="space-y-6">
        <!-- Broker Selection -->
        <USelect
          v-model="selectedBroker"
          :options="brokers"
          placeholder="Select your broker"
          searchable
          class="w-full"
        />

        <!-- File Input -->
        <div v-if="selectedBroker" class="space-y-2">
          <UInput
            type="file"
            v-model="selectedFile"
            :accept="['text/csv', 'application/vnd.ms-excel']"
            label="Upload your broker file"
            @change="handleFileChange"
          />
        </div>

        <!-- Ghostfolio settings -->
        <div v-if="selectedFile" class="text-center space-y-4">
          <h3 class="text-xl font-semibold text-left">Ghostfolio Settings</h3>
          <div class="flex space-x-4 mx-1 my-2">
            <UCheckbox v-model="GHOSTFOLIO_VALIDATE" name="GHOSTFOLIO_VALIDATE" label="Validate" />
            <UCheckbox v-model="GHOSTFOLIO_IMPORT" name="GHOSTFOLIO_IMPORT" label="Import" />
            <UCheckbox v-model="GHOSTFOLIO_UPDATE_CASH" name="GHOSTFOLIO_UPDATE_CASH" label="Update cash" />
          </div>
          <UInput v-model="GHOSTFOLIO_ACCOUNT_ID" placeholder="GHOSTFOLIO_ACCOUNT_ID" icon="heroicons:identification-solid" class="my-4" :required="true" />
          <UInput v-if="GHOSTFOLIO_IMPORT" v-model="GHOSTFOLIO_URL" placeholder="GHOSTFOLIO_URL" icon="heroicons:link-solid" class="my-4" />
          <UInput v-if="GHOSTFOLIO_IMPORT" v-model="GHOSTFOLIO_SECRET" placeholder="GHOSTFOLIO_SECRET" icon="heroicons:ellipsis-horizontal-circle" class="my-4" />
        </div>

        <!-- Process Button -->
        <UButton
          v-if="selectedFile"
          :loading="isProcessing"
          @click="processFile"
          color="primary"
          block
        >
          Process
        </UButton>

        <!-- Processing Animation -->
        <div v-if="isProcessing" class="text-center space-y-4">
          <UProgress animation="carousel" class="w-full" />
          <p class="text-gray-600 animate-pulse">{{ processingMessage }}</p>
        </div>

        <!-- Action Buttons -->
        <div v-if="isProcessed" class="flex space-x-4">
          <div class="w-full">
            <UButton
              block
              icon="heroicons:arrow-down-tray-solid"
              color="primary"
              @click="downloadResults"
            >
              Download Results
            </UButton>
          </div>
          <div class="w-full" v-if="GHOSTFOLIO_URL">
            <UButton
              block
              icon="heroicons:presentation-chart-line-solid"
              color="gray"
              :loading="isConnecting"
              :to="GHOSTFOLIO_URL"
              target="_blank"
            >
              Connect to Ghostfolio
            </UButton>
          </div>
        </div>

      </div>
    </UCard>
  </div>
  <div class="max-w-2xl mx-auto p-6 space-y-8">
    <UCard>
      <div class="flex space-x-4 justify-between">
        <h2 class="text-xl font-semibold">Server log</h2>
        <UCheckbox v-model="showServerLogs" />
      </div>
      <UTextarea v-if="showServerLogs" disabled v-model="logs" :rows="30" :maxrows="100" />
    </UCard>
  </div>
  <UNotifications />
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, Ref, ref } from 'vue'

const toast = useToast()
const config = useRuntimeConfig()

// Broker options
const brokers = [
  { label: 'Bv',            value: 'bv'},
  { label: 'Bitvavo',       value: 'bitvavo'},
  { label: 'Bux',           value: 'bux'},
  { label: 'Degiro-v1',     value: 'degiro-v1'},
  { label: 'Degiro',        value: 'degiro'},
  { label: 'Degiro-v3',     value: 'degiro-v3'},
  { label: 'Etoro',         value: 'etoro'},
  { label: 'Fp',            value: 'fp'},
  { label: 'Finpension',    value: 'finpension'},
  { label: 'Ft',            value: 'ft'},
  { label: 'Freetrade',     value: 'freetrade'},
  { label: 'Ibkr',          value: 'ibkr'},
  { label: 'Investimental', value: 'investimental'},
  { label: 'Parqet',        value: 'parqet'},
  { label: 'Rabobank',      value: 'rabobank'},
  { label: 'Revolut',       value: 'revolut'},
  { label: 'Schwab',        value: 'schwab'},
  { label: 'Sq',            value: 'sq'},
  { label: 'Swissquote',    value: 'swissquote'},
  { label: 'T212',          value: 't212'},
  { label: 'Trading212',    value: 'trading212'},
  { label: 'Xtb',           value: 'xtb'},
]

const selectedBroker = ref(null)
const selectedFile: Ref<File, File> = ref(null)
const isProcessing = ref(false)
const isProcessed = ref(false)
const isConnecting = ref(false)
const showServerLogs = ref(false)
const logs = ref("")
let configUpdated;

const GHOSTFOLIO_VALIDATE = ref(!!config.public.GHOSTFOLIO_VALIDATE || false);
const GHOSTFOLIO_IMPORT = ref(!!config.public.GHOSTFOLIO_IMPORT || false);
const GHOSTFOLIO_UPDATE_CASH = ref(!!config.public.GHOSTFOLIO_UPDATE_CASH || false);
const GHOSTFOLIO_ACCOUNT_ID = ref(config.public.GHOSTFOLIO_ACCOUNT_ID || "");
const GHOSTFOLIO_URL = ref(config.public.GHOSTFOLIO_URL || "");
const GHOSTFOLIO_SECRET = ref(config.public.GHOSTFOLIO_SECRET || "");

const serverUrl = config.public.serverUrl;

showServerLogs.value = config.public.isDev || false;


try {
  fetch("/env").then(async (response) => {
    const data = await response.json();
    configUpdated = data;
    if (data.GHOSTFOLIO_ACCOUNT_ID) GHOSTFOLIO_ACCOUNT_ID.value = data.GHOSTFOLIO_ACCOUNT_ID;
    if (data.GHOSTFOLIO_URL) GHOSTFOLIO_URL.value = data.GHOSTFOLIO_URL;
    if (data.GHOSTFOLIO_SECRET) GHOSTFOLIO_SECRET.value = data.GHOSTFOLIO_SECRET;
    if (data.GHOSTFOLIO_VALIDATE) GHOSTFOLIO_VALIDATE.value = data.GHOSTFOLIO_VALIDATE;
    if (data.GHOSTFOLIO_IMPORT) GHOSTFOLIO_IMPORT.value = data.GHOSTFOLIO_IMPORT;
    if (data.GHOSTFOLIO_UPDATE_CASH) GHOSTFOLIO_UPDATE_CASH.value = data.GHOSTFOLIO_UPDATE_CASH;
    
    showServerLogs.value = data?.isDev || false;
  });
} catch (error) {
  console.error('Error fetching config:', error);
}

// Messages shown during processing to provide feedback
const processingMessages = [
  'Processing your data...',
  'Checking transaction logs...',
  'Connecting to stock markets...',
  'Mining some Bitcoin to make this work...',
  'Analyzing market patterns...'
]

const processingMessage = ref(processingMessages[0])
let messageInterval

// Handles file input changes
const handleFileChange = (files: FileList) => {
  if (files.length > 0) {
    selectedFile.value = files[0]
  }
}

// Downloads a file from a given URL
async function downloadFile(url: string, fileName: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error('Error downloading file:', error);
    toast.add({ title: 'Error downloading the file.' })
  }
}

let lastResponse: any;

// Processes the selected file
const processFile = async () => {
  if (!selectedFile.value || !selectedBroker.value) {
    toast.add({ title: 'Please select a broker and a file before processing.' });
    return;
  }

  isProcessing.value = true
  let messageIndex = 0

  messageInterval = setInterval(() => {
    messageIndex = (messageIndex + 1) % processingMessages.length
    processingMessage.value = processingMessages[messageIndex]
  }, 2000)

  const formData = new FormData();
  formData.append('file', selectedFile.value);
  formData.append('broker', selectedBroker.value);
  formData.append('GHOSTFOLIO_VALIDATE', GHOSTFOLIO_VALIDATE.value.toString());
  formData.append('GHOSTFOLIO_IMPORT', GHOSTFOLIO_IMPORT.value.toString());
  formData.append('GHOSTFOLIO_UPDATE_CASH', GHOSTFOLIO_UPDATE_CASH.value.toString());
  formData.append('GHOSTFOLIO_ACCOUNT_ID', GHOSTFOLIO_ACCOUNT_ID.value);
  formData.append('GHOSTFOLIO_URL', GHOSTFOLIO_URL.value);
  formData.append('GHOSTFOLIO_SECRET', GHOSTFOLIO_SECRET.value);

  try {
    const response = await fetch(serverUrl + 'upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to process file: ${response.statusText}`);
    }

    lastResponse = await response.json();
    isProcessed.value = true
  } catch (error) {
    console.error('Error processing file:', error);
    toast.add({ title: 'Error during file processing, please check logs.' })
    isProcessed.value = false
  }

  isProcessing.value = false
  if (messageInterval) clearInterval(messageInterval)
}

// Downloads the results after processing
const downloadResults = () => {
  if (!lastResponse || !lastResponse.url) {
    toast.add({ title: 'No result file available.' });
    return;
  }
  downloadFile(serverUrl + lastResponse.url, lastResponse.url.replaceAll("/", "_").replaceAll("\\", "_"));
}

// WebSocket to receive server logs in real-time
const socket = new WebSocket(serverUrl.replace('http', 'ws'));

// Handle WebSocket open event
socket.addEventListener('open', () => {
  console.log('WebSocket connection opened.');
});

// Formats current date/time for logging
function formatDateTime() {
  const now = new Date();
  const padZero = (num: number) => (num < 10 ? `0${num}` : num);
  return `${padZero(now.getDate())}/${padZero(now.getMonth() + 1)}/${now.getFullYear()} ${padZero(now.getHours())}:${padZero(now.getMinutes())}:${padZero(now.getSeconds())}`;
}

// Handle messages from the server via WebSocket
socket.addEventListener('message', (event) => {
  const formattedDateTime = formatDateTime(); 
  const textToAdd = `${formattedDateTime} - ${event.data} \n`;

  console.log(textToAdd);
  nextTick(() => {
    logs.value += textToAdd;
    const textarea = document.querySelector("textarea");
    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  });
});

// Handle WebSocket errors
socket.addEventListener('error', (error) => {
  console.error('WebSocket error:', error);
});

// Handle WebSocket close event
socket.addEventListener('close', () => {
  console.log('WebSocket connection closed.');
});

// Cleanup when component is unmounted
onBeforeUnmount(() => {
  if (messageInterval) {
    clearInterval(messageInterval)
  }
});
</script>
